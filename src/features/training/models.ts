export type SetType =
  "bodyweight" | "weighted" | "assisted" | "hold" | "timed" | "skill";
export type Technique = "Clean" | "Acceptable" | "Failed";
export interface Prescription {
  exerciseId: string;
  sets: number;
  min: number;
  max: number;
  rest: number;
  rir: number;
  load: number;
  minutes?: string;
  attemptsMax?: number;
}
export interface Exercise {
  id: string;
  name: string;
  type: SetType;
  unilateral: boolean;
  category: string;
  pattern: string;
  classification: string;
  equipment: string;
  purpose: string;
  muscles: string;
  secondary: string;
  joints: string;
  cues: string;
  mistakes: string[];
  progressions: string;
  regressions: string;
  reference: string;
  restrictions: string;
  main: boolean;
}
export interface WorkoutDay {
  name: string;
  exercises: Prescription[];
}
export interface Plan {
  name: string;
  start: string;
  days: WorkoutDay[];
}
export interface Attachment {
  url: string;
  kind: "video";
}
export interface SkillAttempt {
  method: "wall" | "block" | "kick-up" | "freestanding";
  surface: "parallettes" | "dumbbells";
  successful: boolean;
  seconds: number;
}
export interface SetLog {
  id: string;
  exerciseId: string;
  reps: number;
  seconds: number;
  load: number;
  rir: number;
  technique: Technique;
  mistakes: string[];
  pain: number;
  side: "left" | "right" | "both";
  notes: string;
  attachment: Attachment | null;
  skill: SkillAttempt | null;
  at: number;
  rest: number;
}
export interface Session {
  id: string;
  date: string;
  name: string;
  status: "active" | "completed" | "partial" | "skipped";
  started: number;
  ended: number | null;
  pausedAt: number | null;
  pausedMs: number;
  restUntil: number | null;
  restRemaining: number;
  exercises: Prescription[];
  sets: SetLog[];
  skipped: string[];
  index: number;
  after: Record<string, number>;
  morning: Record<string, number>;
  notes: string;
}
export interface SymptomCheckIn {
  energy: number;
  sleep: number;
  wrist: number;
  ankle: number;
  walking: number;
  weight: number;
  recovery: string;
  concerning: boolean;
}
export interface MistakeTag {
  exerciseId: string;
  label: string;
}
export interface TrainingState {
  version: 1;
  plan: Plan;
  exercises: Exercise[];
  sessions: Session[];
  checkins: Record<string, SymptomCheckIn>;
  settings: {
    phase: 1 | 2;
    prStandard: "Clean" | "Acceptable";
    wristAssessed: boolean;
    dipsPainFree: boolean;
  };
  recovery: { enabled: boolean; notes: string };
  appliedProgressions?: string[];
}
