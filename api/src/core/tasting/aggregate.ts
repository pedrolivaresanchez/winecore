import { roundTo } from './rows';
import { SELECTED_YES_RATIO } from './types';

export interface VoteFact {
  sample_no: number;
  day_no: number;
  taster_name: string;
  vote: 'yes' | 'no';
  score: number | null;
}

export interface DayBallot {
  day_no: number;
  yes: number;
  no: number;
  yes_ratio: number;
  mean_score: number | null;
}

export interface SampleAggregate {
  sample_no: number;
  votes: number;
  yes: number;
  no: number;
  yes_ratio: number;
  mean_score: number | null;
  /** Share of tasters whose yes/no did not change across the days they voted. Null if nobody repeated a day. */
  consistency: number | null;
  days: DayBallot[];
  selected: boolean;
}

export function aggregateSamples(
  sampleNos: readonly number[],
  votes: readonly VoteFact[],
): SampleAggregate[] {
  return [...sampleNos].sort((a, b) => a - b).map((sampleNo) => {
    const rows = votes.filter((vote) => vote.sample_no === sampleNo);
    const yes = rows.filter((vote) => vote.vote === 'yes').length;
    const no = rows.length - yes;
    const scores = rows.map((vote) => vote.score).filter((score): score is number => score != null);
    const days = [...new Set(rows.map((vote) => vote.day_no))].sort((a, b) => a - b).map((dayNo) => {
      const dayRows = rows.filter((vote) => vote.day_no === dayNo);
      const dayYes = dayRows.filter((vote) => vote.vote === 'yes').length;
      const dayScores = dayRows.map((vote) => vote.score).filter((score): score is number => score != null);
      return {
        day_no: dayNo,
        yes: dayYes,
        no: dayRows.length - dayYes,
        yes_ratio: ratio(dayYes, dayRows.length),
        mean_score: mean(dayScores),
      };
    });
    const yesRatio = ratio(yes, rows.length);
    return {
      sample_no: sampleNo,
      votes: rows.length,
      yes,
      no,
      yes_ratio: yesRatio,
      mean_score: mean(scores),
      consistency: consistencyOf(rows),
      days,
      selected: rows.length > 0 && yesRatio >= SELECTED_YES_RATIO,
    };
  });
}

function ratio(yes: number, total: number): number {
  if (total === 0) return 0;
  return roundTo(yes / total, 4);
}

function mean(scores: readonly number[]): number | null {
  if (scores.length === 0) return null;
  const total = scores.reduce((sum, score) => sum + score, 0);
  return roundTo(total / scores.length, 2);
}

function consistencyOf(rows: readonly VoteFact[]): number | null {
  const byTaster = new Map<string, VoteFact[]>();
  for (const row of rows) {
    const key = row.taster_name.trim().toLowerCase();
    const list = byTaster.get(key) ?? [];
    list.push(row);
    byTaster.set(key, list);
  }
  let comparable = 0;
  let stable = 0;
  for (const list of byTaster.values()) {
    const days = new Set(list.map((vote) => vote.day_no));
    if (days.size < 2) continue;
    comparable += 1;
    const first = list[0]?.vote;
    if (first && list.every((vote) => vote.vote === first)) stable += 1;
  }
  if (comparable === 0) return null;
  return roundTo(stable / comparable, 4);
}
