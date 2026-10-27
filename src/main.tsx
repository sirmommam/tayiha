import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QuizApp } from "@/components/quiz/QuizApp";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing root");
createRoot(root).render(
  <StrictMode>
    <QuizApp />
  </StrictMode>,
);
