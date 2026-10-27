import { useEffect, useRef, useState, type FormEvent } from "react";
import { Flag, RotateCcw, SkipForward, Timer, Trophy, Volume2, VolumeX, Zap } from "lucide-react";
import { CATEGORIES, categoryName, poolSize, type CategoryId } from "@/lib/quiz/bank";
import {
  ROUND_SIZE,
  TIME_OPTIONS,
  bestKey,
  isCorrect,
  pickRound,
  scoreHit,
  verdict,
  type RoundItem,
  type TimeOption,
} from "@/lib/quiz/engine";
import { sfxBad, sfxEnd, sfxOk, sfxTick, unlockAudio } from "@/lib/quiz/sfx";

const SAVE_KEY = "tayiha-save-v1";

type Save = {
  version: 1;
  best: Record<string, number>;
  sound: boolean;
};

type Live = {
  questions: ReturnType<typeof pickRound>;
  index: number;
  score: number;
  base: number;
  speed: number;
  streakPts: number;
  bestStreak: number;
  streak: number;
  items: RoundItem[];
  category: CategoryId;
  durationMs: number;
  startedAt: number;
};

type Flash = { kind: "ok" | "bad"; title: string; detail: string } | null;
type Phase = "home" | "play" | "summary";

const EMPTY_SAVE: Save = { version: 1, best: {}, sound: true };

function loadSave(): Save {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return EMPTY_SAVE;
    const parsed = JSON.parse(raw) as Partial<Save>;
    if (parsed.version !== 1 || typeof parsed.best !== "object" || !parsed.best) return EMPTY_SAVE;
    return { version: 1, best: parsed.best, sound: parsed.sound !== false };
  } catch {
    return EMPTY_SAVE;
  }
}

function formatLeft(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds >= 10) return String(Math.ceil(seconds));
  return seconds.toFixed(1);
}

function blankItem(question: Live["questions"][number], status: "skip" | "timeout"): RoundItem {
  return { question, input: "", status, points: 0, speed: 0, streakBonus: 0, elapsed: 0 };
}

function nudge(node: HTMLElement | null) {
  node?.animate(
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-7px)" },
      { transform: "translateX(7px)" },
      { transform: "translateX(-4px)" },
      { transform: "translateX(0)" },
    ],
    { duration: 320, easing: "ease-in-out" },
  );
}

export function QuizApp() {
  const [phase, setPhase] = useState<Phase>("home");
  const [category, setCategory] = useState<CategoryId>("mix");
  const [seconds, setSeconds] = useState<TimeOption>(60);
  const [save, setSave] = useState<Save>(EMPTY_SAVE);
  const [live, setLive] = useState<Live | null>(null);
  const [leftMs, setLeftMs] = useState(60_000);
  const [input, setInput] = useState("");
  const [flash, setFlash] = useState<Flash>(null);
  const [usedMs, setUsedMs] = useState(0);
  const [roundKey, setRoundKey] = useState(0);
  const [locked, setLocked] = useState(false);
  const [freshRecord, setFreshRecord] = useState(false);

  const liveRef = useRef<Live | null>(null);
  const endsAtRef = useRef(0);
  const questionAtRef = useRef(0);
  const finishedRef = useRef(false);
  const lockedRef = useRef(false);
  const soundRef = useRef(true);
  const saveRef = useRef(save);
  const advanceRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const finishRef = useRef<(reason: "time" | "clear" | "quit") => void>(() => {});

  useEffect(() => {
    const loaded = loadSave();
    setSave(loaded);
    saveRef.current = loaded;
  }, []);

  useEffect(() => {
    soundRef.current = save.sound;
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  useEffect(() => {
    if (phase !== "play") return;
    let frame = 0;
    let lastShown = -1;
    let lastSec = -1;
    const loop = () => {
      const left = Math.max(0, endsAtRef.current - performance.now());
      const shown = Math.ceil(left / 100);
      if (shown !== lastShown) {
        lastShown = shown;
        setLeftMs(left);
      }
      const sec = Math.ceil(left / 1000);
      if (sec > 0 && sec <= 5 && sec !== lastSec) {
        if (lastSec !== -1) sfxTick(soundRef.current);
        lastSec = sec;
      }
      if (left <= 0) {
        finishRef.current("time");
        return;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [phase, roundKey]);

  useEffect(() => {
    if (phase === "play" && !locked) inputRef.current?.focus();
  }, [phase, live?.index, roundKey, locked]);

  function persist(next: Save) {
    saveRef.current = next;
    setSave(next);
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  }

  function commit(next: Live) {
    liveRef.current = next;
    setLive(next);
  }

  finishRef.current = (reason) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    window.clearTimeout(advanceRef.current);
    lockedRef.current = true;
    setLocked(true);
    const current = liveRef.current;
    if (!current) return;
    const items = [...current.items];
    const answered = new Set(items.map((item) => item.question.id));
    const status = reason === "quit" ? "skip" : "timeout";
    if (reason !== "clear") {
      for (const question of current.questions) {
        if (!answered.has(question.id)) items.push(blankItem(question, status));
      }
    }
    const used = Math.min(current.durationMs, Math.max(0, performance.now() - current.startedAt));
    commit({ ...current, items });
    setUsedMs(used);
    setFlash(null);
    setPhase("summary");
    sfxEnd(soundRef.current);
    const key = bestKey(current.category, Math.round(current.durationMs / 1000));
    const prior = saveRef.current.best[key] ?? 0;
    setFreshRecord(current.score > prior && current.score > 0);
    if (current.score > prior) {
      persist({ ...saveRef.current, best: { ...saveRef.current.best, [key]: current.score } });
    }
  };

  function armAdvance(delay: number) {
    window.clearTimeout(advanceRef.current);
    advanceRef.current = window.setTimeout(() => {
      if (finishedRef.current) return;
      const current = liveRef.current;
      if (!current) return;
      if (performance.now() >= endsAtRef.current) {
        finishRef.current("time");
        return;
      }
      const nextIndex = current.index + 1;
      if (nextIndex >= current.questions.length) {
        finishRef.current("clear");
        return;
      }
      commit({ ...current, index: nextIndex });
      questionAtRef.current = performance.now();
      setInput("");
      setFlash(null);
      lockedRef.current = false;
      setLocked(false);
    }, delay);
  }

  function resolve(status: "correct" | "wrong" | "skip", text: string) {
    const current = liveRef.current;
    if (!current || lockedRef.current || finishedRef.current) return;
    const question = current.questions[current.index];
    if (!question) return;
    lockedRef.current = true;
    setLocked(true);
    const elapsed = (performance.now() - questionAtRef.current) / 1000;
    const ok = status === "correct";
    const nextStreak = ok ? current.streak + 1 : 0;
    const gained = ok ? scoreHit(elapsed, nextStreak) : { base: 0, speed: 0, streakBonus: 0, total: 0 };
    const item: RoundItem = {
      question,
      input: text,
      status,
      points: gained.total,
      speed: gained.speed,
      streakBonus: gained.streakBonus,
      elapsed,
    };
    commit({
      ...current,
      score: current.score + gained.total,
      base: current.base + gained.base,
      speed: current.speed + gained.speed,
      streakPts: current.streakPts + gained.streakBonus,
      bestStreak: Math.max(current.bestStreak, nextStreak),
      streak: nextStreak,
      items: [...current.items, item],
    });
    if (ok) {
      sfxOk(soundRef.current);
      navigator.vibrate?.(12);
      setFlash({
        kind: "ok",
        title: `+${gained.total}`,
        detail: gained.speed > 0 ? `${question.answers[0]} · ความเร็ว +${gained.speed}` : question.answers[0],
      });
    } else {
      sfxBad(soundRef.current);
      navigator.vibrate?.([16, 30, 16]);
      nudge(inputRef.current);
      setFlash({
        kind: "bad",
        title: status === "skip" ? "ข้ามไปก่อน" : "ยังไม่โดน",
        detail: `เฉลย ${question.answers[0]}`,
      });
    }
    armAdvance(ok ? 720 : 1280);
  }

  function startRound() {
    unlockAudio();
    const questions = pickRound(category, ROUND_SIZE);
    const now = performance.now();
    const durationMs = seconds * 1000;
    finishedRef.current = false;
    lockedRef.current = false;
    setLocked(false);
    endsAtRef.current = now + durationMs;
    questionAtRef.current = now;
    commit({
      questions,
      index: 0,
      score: 0,
      base: 0,
      speed: 0,
      streakPts: 0,
      bestStreak: 0,
      streak: 0,
      items: [],
      category,
      durationMs,
      startedAt: now,
    });
    setLeftMs(durationMs);
    setInput("");
    setFlash(null);
    setUsedMs(0);
    setFreshRecord(false);
    setRoundKey((key) => key + 1);
    setPhase("play");
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text) {
      nudge(inputRef.current);
      return;
    }
    const question = liveRef.current?.questions[liveRef.current.index];
    if (!question) return;
    resolve(isCorrect(text, question.answers) ? "correct" : "wrong", text);
  }

  const selected = CATEGORIES.find((item) => item.id === category) ?? CATEGORIES[0];
  const record = save.best[bestKey(category, seconds)] ?? 0;
  const question = live?.questions[live.index];
  const urgent = leftMs <= 10_000;
  const remainPct = live ? Math.max(0, Math.min(100, (leftMs / live.durationMs) * 100)) : 0;
  const correctCount = live?.items.filter((item) => item.status === "correct").length ?? 0;
  const wrongCount = live?.items.filter((item) => item.status === "wrong").length ?? 0;
  const skipCount = live?.items.filter((item) => item.status === "skip").length ?? 0;
  const timeoutCount = live?.items.filter((item) => item.status === "timeout").length ?? 0;
  const summary = live ? verdict(correctCount, live.questions.length) : null;

  return (
    <main
      className={
        "app-shell mx-auto flex w-full max-w-md flex-col px-4 pt-5 " +
        (phase === "play" ? "h-dvh overflow-hidden" : "min-h-dvh")
      }
    >
      {phase === "home" && selected ? (
        <section className="flex flex-1 flex-col gap-5">
          <header className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-sm tracking-wide text-mango">ซุ้มทายชื่อ</p>
              <h1 className="font-display text-5xl leading-none text-cream">ทายฮา</h1>
              <p className="mt-2 max-w-xs text-base text-muted">
                สุ่ม {ROUND_SIZE} ข้อจากอีโมจิ ตอบถูกได้คะแนน ตอบเร็วได้เพิ่ม
              </p>
            </div>
            <button
              type="button"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-cream/10 text-cream"
              aria-pressed={save.sound}
              aria-label={save.sound ? "ปิดเสียง" : "เปิดเสียง"}
              onClick={() => {
                unlockAudio();
                persist({ ...save, sound: !save.sound });
              }}
            >
              {save.sound ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
            </button>
          </header>

          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="ข้อต่อรอบ" value={String(ROUND_SIZE)} />
            <Stat label="ตอบถูก" value="+100" />
            <Stat label="เร็วสุด" value="+80" />
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-muted">
              <Timer className="size-4 text-mango" />
              เวลาทั้งรอบ
            </div>
            <div className="grid grid-cols-4 gap-2">
              {TIME_OPTIONS.map((option) => {
                const active = option === seconds;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSeconds(option)}
                    className={
                      "h-11 rounded-full font-display text-base " +
                      (active ? "bg-mango text-ink" : "bg-cream/10 text-cream")
                    }
                  >
                    {option} วิ
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((item) => {
              const active = item.id === category;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCategory(item.id)}
                  className={
                    "flex min-h-14 items-center gap-3 rounded-ticket px-3 py-2 text-left " +
                    (active ? "bg-mango text-ink" : "bg-cream/10 text-cream ring-1 ring-cream/15")
                  }
                >
                  <span className="text-3xl leading-none" aria-hidden="true">
                    {item.emoji}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-display text-lg leading-tight">{item.name}</span>
                    <span className={"block truncate text-sm " + (active ? "text-ink/70" : "text-muted")}>
                      {poolSize(item.id)} ข้อในคลัง
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <p className="text-sm text-muted">
            {selected.blurb} ตอบใน {8} วินาทีแรกได้คะแนนความเร็ว ถูกติดกันได้โบนัส
          </p>

          <div className="sticky bottom-0 z-10 -mx-4 mt-auto bg-ink px-4 pt-3">
            {record > 0 ? (
              <p className="mb-2 flex items-center justify-center gap-2 text-sm text-mango">
                <Trophy className="size-4" />
                สถิติหมวดนี้ {record.toLocaleString("th-TH")} คะแนน
              </p>
            ) : null}
            <button type="button" onClick={startRound} className="h-14 w-full rounded-full bg-mango font-display text-xl text-ink">
              เริ่มทาย {seconds} วินาที
            </button>
          </div>
        </section>
      ) : null}

      {phase === "play" && live && question ? (
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="h-2 overflow-hidden rounded-full bg-cream/15">
            <div
              className={"h-full rounded-full " + (urgent ? "bg-chili" : "bg-mango")}
              style={{ width: `${remainPct}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className={"font-display text-4xl leading-none " + (urgent ? "animate-timer text-chili" : "text-cream")}>
              {formatLeft(leftMs)}
              <span className="ml-1 text-base text-muted">วิ</span>
            </p>
            <div className="text-right">
              <p className="font-display text-2xl leading-none text-mango">{live.score.toLocaleString("th-TH")}</p>
              <p className="text-sm text-muted">
                ข้อ {live.index + 1}/{live.questions.length}
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="rounded-full bg-cream/10 px-3 py-1 text-sm text-cream">{categoryName(question.category)}</p>
            <div className="flex items-center gap-3">
              {live.streak > 1 ? (
                <p className="flex items-center gap-1 text-sm text-mango">
                  <Zap className="size-4" />
                  ติดกัน {live.streak}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => finishRef.current("quit")}
                className="flex min-h-11 items-center gap-1 text-sm text-muted"
              >
                <Flag className="size-4" />
                ยอมแพ้
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-2">
            <p key={question.id} className="animate-pop text-center text-6xl leading-tight tracking-wide select-none">
              {question.emoji}
            </p>
            <div className="mt-5 min-h-16 text-center">
              {flash ? (
                <>
                  <p className={"font-display text-2xl " + (flash.kind === "ok" ? "text-leaf" : "text-chili")}>{flash.title}</p>
                  <p className="text-base text-cream">{flash.detail}</p>
                </>
              ) : (
                <p className="text-base text-muted">พิมพ์ชื่อที่อีโมจิใบ้นี้</p>
              )}
            </div>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-2">
            <label className="sr-only" htmlFor="guess">
              คำตอบ
            </label>
            <input
              id="guess"
              ref={inputRef}
              value={input}
              disabled={locked}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              placeholder="พิมพ์คำตอบแล้วกดส่ง"
              onChange={(event) => setInput(event.target.value)}
              className="h-14 w-full rounded-ticket bg-cream px-4 text-base text-ink outline-none placeholder:text-ink/40 disabled:opacity-70"
            />
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <button
                type="submit"
                disabled={locked}
                className="h-12 rounded-full bg-mango font-display text-lg text-ink disabled:opacity-50"
              >
                ส่งคำตอบ
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() => resolve("skip", "")}
                className="flex h-12 items-center gap-1 rounded-full bg-cream/10 px-4 text-cream disabled:opacity-50"
              >
                <SkipForward className="size-4" />
                ข้าม
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {phase === "summary" && live && summary ? (
        <section className="flex flex-1 flex-col gap-4">
          <header>
            <p className="text-sm text-mango">
              {categoryName(live.category)} · {Math.round(live.durationMs / 1000)} วินาที
            </p>
            <h1 className="font-display text-4xl leading-tight text-cream">{summary.title}</h1>
            <p className="mt-1 text-base text-muted">{summary.line}</p>
          </header>

          <article className="rounded-ticket bg-paper px-4 py-4 text-ink">
            <p className="text-center text-sm">ใบสรุปทายฮา</p>
            <p className="text-center font-display text-5xl leading-none">{live.score.toLocaleString("th-TH")}</p>
            <p className="mb-3 text-center text-sm">คะแนนรวม</p>
            {freshRecord ? <p className="mb-3 text-center font-display text-base">สถิติใหม่ของรอบนี้</p> : null}
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-dashed border-ink/20 pt-3 text-sm">
              <Receipt label="ตอบถูก" value={`${correctCount} ข้อ · +${live.base}`} />
              <Receipt label="คะแนนความเร็ว" value={`+${live.speed}`} />
              <Receipt label="โบนัสติดกัน" value={`+${live.streakPts}`} />
              <Receipt label="สตรีคสูงสุด" value={`${live.bestStreak} ข้อ`} />
              <Receipt label="ผิด / ข้าม" value={`${wrongCount} / ${skipCount}`} />
              <Receipt label="ไม่ทันเวลา" value={`${timeoutCount} ข้อ`} />
              <Receipt label="ใช้เวลา" value={`${Math.max(1, Math.round(usedMs / 1000))} วิ`} />
              <Receipt label="จากเวลา" value={`${Math.round(live.durationMs / 1000)} วิ`} />
            </dl>
          </article>

          <ol className="flex flex-col gap-2">
            {live.items.map((item, index) => (
              <li key={item.question.id} className="flex items-center gap-3 rounded-2xl bg-cream/10 px-3 py-2">
                <span className="w-6 text-sm text-muted">{index + 1}</span>
                <span className="text-2xl leading-none" aria-hidden="true">
                  {item.question.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-base">{item.question.answers[0]}</span>
                  <span className="block truncate text-sm text-muted">
                    {item.status === "correct"
                      ? item.input
                      : item.status === "wrong"
                        ? `ตอบ ${item.input || "—"}`
                        : item.status === "skip"
                          ? "ข้าม"
                          : "เวลาหมด"}
                  </span>
                </span>
                <span className={"font-display text-sm " + (item.status === "correct" ? "text-leaf" : "text-chili")}>
                  {item.status === "correct" ? `+${item.points}` : "0"}
                </span>
              </li>
            ))}
          </ol>

          <div className="sticky bottom-0 z-10 -mx-4 mt-auto grid grid-cols-2 gap-2 bg-ink px-4 pt-3">
            <button
              type="button"
              onClick={() => setPhase("home")}
              className="flex h-12 items-center justify-center gap-2 rounded-full bg-cream/10 font-display text-base text-cream"
            >
              <RotateCcw className="size-4" />
              เปลี่ยนหมวด
            </button>
            <button type="button" onClick={startRound} className="h-12 rounded-full bg-mango font-display text-base text-ink">
              เล่นอีกรอบ
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-cream/10 px-2 py-3">
      <p className="font-display text-xl text-mango">{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

function Receipt({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink/60">{label}</dt>
      <dd className="font-display text-base">{value}</dd>
    </div>
  );
}
