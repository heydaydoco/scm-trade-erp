import { redirect } from "next/navigation";

// P0: 루트(/) 접속 시 거래처 목록 화면으로 보낸다.
export default function Home() {
  redirect("/partners");
}
