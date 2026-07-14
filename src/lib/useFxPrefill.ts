"use client";

import { useState } from "react";
import { BASE_CURRENCY } from "@/config/company";
import type { LatestRate } from "@/services/types";

/**
 * 환율 프리필 상태머신 (견적·수주 폼 공용) — 원칙 1-B.
 *
 * 통화 선택 시 대장(getLatestRates) 최신 환율을 자동 채우되, 수동 수정도 허용한다.
 * rate는 대장이 이미 1단위로 정규화한 값이라 그대로 문서 exchangeRate에 넣는다(100배 함정은
 * 대장 입력단에서 이미 처리됨). 문서는 대장을 FK로 참조하지 않고 값만 스냅샷 저장하므로,
 * 이후 대장이 바뀌어도 저장된 문서 환율은 불변이다.
 *
 * 출처(source)·고시시점(quotedAt)은 수주만 컬럼으로 저장한다(견적 RPC는 미지원 → 견적은 rate만 사용).
 */
export interface FxPrefillInit {
  rates: Record<string, LatestRate>;
  initialCurrency: string;
  initialRate: string; // 기존 문서/드래프트/에러재시드에서 온 값
  initialSource: string;
  initialQuotedAt: string;
  /** 빈 신규 문서일 때만 마운트 시 대장값으로 자동 프리필(기존 문서·드래프트·에러재시드는 스냅샷 존중). */
  autoPrefill: boolean;
}

export interface FxPrefillState {
  rate: string;
  source: string;
  quotedAt: string;
  /** 통화 변경 핸들러 — 대장에 최신 환율이 있으면 rate/source/quotedAt를 채운다. */
  onCurrencyChange: (currency: string) => void;
  /** 환율 직접 수정 — 출처를 '수동입력'으로 표시(출처 정직성). */
  onRateEdit: (value: string) => void;
  /** 해당 통화의 대장 최신값(있으면). 힌트 표시용. base 통화는 rate=1 합성값. */
  latestFor: (currency: string) => LatestRate | null;
}

function computeFor(
  rates: Record<string, LatestRate>,
  currency: string,
): { rate: string; source: string; quotedAt: string } | null {
  if (currency === BASE_CURRENCY) {
    return { rate: "1", source: "기준통화", quotedAt: "" };
  }
  const r = rates[currency];
  if (!r) return null;
  return {
    rate: String(r.rate),
    source: r.source ?? "환율대장",
    quotedAt: r.quotedAt ?? "",
  };
}

export function useFxPrefill(init: FxPrefillInit): FxPrefillState {
  const seed = init.autoPrefill ? computeFor(init.rates, init.initialCurrency) : null;
  const [rate, setRate] = useState(seed?.rate ?? init.initialRate);
  const [source, setSource] = useState(seed?.source ?? init.initialSource);
  const [quotedAt, setQuotedAt] = useState(seed?.quotedAt ?? init.initialQuotedAt);

  function onCurrencyChange(currency: string) {
    const c = computeFor(init.rates, currency);
    if (c) {
      // 대장에 환율이 있으면(또는 기준통화면) 프리필.
      setRate(c.rate);
      setSource(c.source);
      setQuotedAt(c.quotedAt);
    } else {
      // 대장에 없는 비-기준 통화 → 이전 통화의 rate/출처를 절대 승계하지 않는다(원칙 1-B).
      // 안 그러면 예: USD(1350) 프리필 상태에서 EUR로 바꾸면 1350·USD출처가 그대로 남아
      // EUR 문서에 잘못된 환율+거짓 출처가 조용히 스냅샷된다. 비우고 직접 입력을 유도(FxHint).
      setRate("");
      setSource("");
      setQuotedAt("");
    }
  }

  function onRateEdit(value: string) {
    setRate(value);
    setSource("수동입력");
    setQuotedAt("");
  }

  function latestFor(currency: string): LatestRate | null {
    if (currency === BASE_CURRENCY) {
      return { rate: 1, quoteUnit: 1, source: "기준통화", quotedAt: null, rateDate: null };
    }
    return init.rates[currency] ?? null;
  }

  return { rate, source, quotedAt, onCurrencyChange, onRateEdit, latestFor };
}
