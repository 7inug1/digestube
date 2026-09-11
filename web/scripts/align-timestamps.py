"""Align unchanged stored paragraphs to newly fetched timed native captions.
Only actual matched caption ranges are used; no character/time interpolation.
"""
import difflib
import json
import sys
import unicodedata
from pathlib import Path


def normalize(text):
    return ''.join(c for c in unicodedata.normalize('NFKC', text).casefold() if c.isalnum())


def align(chunks, pieces):
    original = ''
    ranges = []
    for chunk in chunks:
        start = len(original)
        original += normalize(chunk['text'])
        ranges.append((start, len(original)))
    source = ''
    owners = []
    for i, piece in enumerate(pieces):
        value = normalize(piece['text'])
        source += value
        owners.extend([i] * len(value))
    matches = difflib.SequenceMatcher(None, original, source, autojunk=False).get_matching_blocks()
    mapping = {}
    # Short isolated character coincidences are not reliable phrase anchors.
    for block in matches:
        if block.size >= 6:
            for offset in range(block.size):
                mapping[block.a + offset] = block.b + offset
    plans = []
    for chunk, (start, end) in zip(chunks, ranges):
        matched = [i for i in range(start, end) if i in mapping]
        if not matched:
            raise ValueError(f"No phrase match for paragraph {chunk['seq']}")
        first, last = matched[0], matched[-1]
        prefix = sum(i in mapping for i in range(start, min(end, start + 60)))
        coverage = len(matched) / max(1, end - start)
        first_piece = pieces[owners[mapping[first]]]
        last_piece = pieces[owners[mapping[last]]]
        plans.append({
            'seq': chunk['seq'], 'old_t': chunk['t'], 'old_t_end': chunk['t_end'],
            't': round(first_piece['offset'] / 1000, 3),
            't_end': round((last_piece['offset'] + last_piece['duration']) / 1000, 3),
            'prefix_skip': first-start, 'prefix_matches': prefix,
            'coverage': round(coverage, 3),
            'safe': first-start <= 12 and prefix >= min(20, (end-start)*0.6) and coverage >= 0.55,
            'start_text': chunk['text'][:90], 'matched_caption': first_piece['text'],
        })
    return plans


def main():
    directory = Path(sys.argv[1])
    report = []
    for before_path in sorted(directory.glob('*-before.json')):
        before = json.loads(before_path.read_text())
        vid = before['video']['id']
        source = json.loads((directory / f'{vid}-source.json').read_text())
        plans = align(before['chunks'], source['content'])
        report.append({'vid': vid, 'revision': before['video']['revision'], 'plans': plans})
        print(vid, 'matched:', sum(p['safe'] for p in plans), '/', len(plans))
        for plan in plans:
            print(json.dumps({k: plan[k] for k in ('seq','old_t','t','prefix_skip','coverage','safe','start_text','matched_caption')}, ensure_ascii=False))
    (directory / 'alignment.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
