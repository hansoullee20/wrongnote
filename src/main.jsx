import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import "./styles.css";
// 색 토큰 — styles.css 뒤에 와야 팔레트 선택자가 기본값을 덮는다
import "./themes.css";

// 새 배포가 올라오면 다음 방문 때 자동으로 최신 버전으로 교체된다.
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
