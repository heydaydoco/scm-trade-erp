import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 서버 전용 Supabase 클라이언트 팩토리.
 *
 * SPEC 원칙 7(로직/화면 분리)의 I/O 경계:
 *  - 화면(app/*)은 이 클라이언트를 직접 호출하지 않는다.
 *  - 오직 services/* 레이어만 이 함수를 사용해 DB에 접근한다.
 *  - 덕분에 나중에 저장소(테이블/백엔드)를 바꿔도 화면은 영향받지 않는다.
 *
 * 환경변수는 NEXT_PUBLIC_ 접두사가 "없으므로" 서버에서만 읽히고
 * 브라우저 번들에는 포함되지 않는다. (.env.local / Vercel 환경변수)
 */
export function createSupabaseServerClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase 환경변수 누락: SUPABASE_URL / SUPABASE_ANON_KEY 를 " +
        ".env.local(로컬) 또는 Vercel 환경변수에 설정하세요.",
    );
  }

  // 서버 측 익명(anon) 읽기 전용 접근이므로 세션 유지가 필요 없다.
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
