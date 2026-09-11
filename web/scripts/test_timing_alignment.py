import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('alignment', Path(__file__).with_name('align-timestamps.py'))
alignment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(alignment)

class AlignmentTests(unittest.TestCase):
    def test_repeated_old_timestamp_replaced_by_matched_caption(self):
        chunks = [dict(seq=0,text='첫 번째 문장을 설명합니다.',t=0,t_end=60),dict(seq=1,text='두 번째 주제로 넘어가겠습니다.',t=0,t_end=60)]
        pieces = [dict(text=chunks[0]['text'],offset=1250,duration=2000),dict(text=chunks[1]['text'],offset=30500,duration=3000)]
        plans = alignment.align(chunks,pieces)
        self.assertEqual([p['t'] for p in plans],[1.25,30.5])
        self.assertTrue(all(p['safe'] for p in plans))
        self.assertEqual(plans[1]['t_end'],33.5)

    def test_unmatched_content_is_not_assigned_a_time(self):
        with self.assertRaises(ValueError):
            alignment.align([dict(seq=0,text='고양이와 강아지의 이야기',t=0,t_end=60)],[dict(text='Completely unrelated source words',offset=1000,duration=1000)])

    def test_small_transcription_differences_use_same_caption(self):
        result = alignment.align([dict(seq=0,text='We should learn programming before building applications.',t=0,t_end=60)],[dict(text='We should learn programming, before building applications!',offset=23120,duration=6000)])
        self.assertTrue(result[0]['safe'])
        self.assertEqual(result[0]['t'],23.12)

if __name__ == '__main__':
    unittest.main()
