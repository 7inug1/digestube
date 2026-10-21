"use client";
import { useEffect } from "react";
import { remember } from "@/lib/mine";

/** 로그인하지 않은 사람이 랜딩에서 넣은 완성된 영상을 이 브라우저의 목록에 담는다. */
export default function KeepInBrowser({ vid }: { vid: string }) {
  useEffect(() => { remember(vid); }, [vid]);
  return null;
}
