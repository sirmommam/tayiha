import { BANK, type CategoryId, type Question } from "./bank";

export const ROUND_SIZE = 10;
export const TIME_OPTIONS = [30, 60, 90, 120] as const;
export const BASE_POINTS = 100;
export const SPEED_MAX = 80;
export const SPEED_WINDOW = 8;
export const STREAK_STEP = 20;

export type TimeOption = (typeof TIME_OPTIONS)[number];

export type ItemStatus = "correct" | "wrong" | "skip" | "timeout";

export type RoundItem = {
  question: Question;
  input: string;
  status: ItemStatus;
  points: number;
  speed: number;
  streakBonus: number;
  elapsed: number;
};

export type ScoreParts = {
  base: number;
  speed: number;
  streakBonus: number;
  total: number;
};

export function normalize(raw: string): string {
  return raw
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s\u200b\u00a0._\-,!?'"“”‘’():;/]/g, "")
    .replace(/์/g, "");
}

export function isCorrect(input: string, answers: readonly string[]): boolean {
  const guess = normalize(input);
  if (!guess) return false;
  return answers.some((answer) => normalize(answer) === guess);
}

export function scoreHit(elapsedSec: number, streak: number): ScoreParts {
  const elapsed = Math.max(0, elapsedSec);
  const speed = Math.max(0, Math.round(SPEED_MAX * (1 - elapsed / SPEED_WINDOW)));
  const streakBonus = streak >= 2 ? STREAK_STEP * (streak - 1) : 0;
  return {
    base: BASE_POINTS,
    speed,
    streakBonus,
    total: BASE_POINTS + speed + streakBonus,
  };
}

export function verdict(correct: number, total: number): { title: string; line: string } {
  if (total > 0 && correct === total) {
    return {
      title: "ราชันอีโมจิ",
      line: "เต็มสิบ สมองลื่นกว่าน้ำจิ้ม ตาไวกว่าคนแย่งของทอด",
    };
  }
  const ratio = total === 0 ? 0 : correct / total;
  if (ratio >= 0.8) {
    return { title: "พิธีกรตัวจริง", line: "เกือบเทพ เหลืออีกนิดจะเปิดซุ้มเอง" };
  }
  if (ratio >= 0.6) {
    return { title: "เดาได้ครึ่งซีก", line: "ถูกเยอะพอให้อิจฉา ผิดพอให้เพื่อนแซว" };
  }
  if (ratio >= 0.4) {
    return { title: "พอได้กลิ่น", line: "ตาเริ่มจับทาง ปากยังลังเลอยู่บ้าง" };
  }
  if (ratio >= 0.2) {
    return { title: "อีโมจิขำก่อน", line: "รอบนี้โดนล้อ รอบหน้าเอาคืนให้มันเข็ด" };
  }
  return { title: "อีโมจิชนะขาด", line: "ไม่เป็นไร ตาพักก่อน แล้วกลับมาทายใหม่" };
}

function shuffle<T>(list: readonly T[]): T[] {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = arr[i];
    const b = arr[j];
    if (a === undefined || b === undefined) continue;
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}

export function pickRound(categoryId: CategoryId, count = ROUND_SIZE): Question[] {
  if (categoryId === "mix") {
    const ids = ["movies", "fruits", "goods", "sports", "food", "home", "drinks"] as const;
    const buckets = ids.map((id) => shuffle(BANK.filter((q) => q.category === id)));
    const picked: Question[] = [];
    let row = 0;
    while (picked.length < count) {
      let grew = false;
      for (const bucket of shuffle(buckets)) {
        const question = bucket[row];
        if (question) {
          picked.push(question);
          grew = true;
        }
        if (picked.length === count) break;
      }
      if (!grew) break;
      row += 1;
    }
    return shuffle(picked);
  }
  return shuffle(BANK.filter((q) => q.category === categoryId)).slice(0, count);
}

export function bestKey(categoryId: CategoryId, seconds: number): string {
  return `${categoryId}:${seconds}`;
}
