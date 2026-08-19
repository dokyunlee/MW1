import { NORMAL_ACCURACY_THRESHOLD } from '@/lib/constants';

export type ParticipantStatus = 'NORMAL' | 'INATTENTIVE' | 'DROPOUT' | null;

type ClassificationInput = {
  startedAt: string | null;
  completedAt: string | null;
  correctTasks: number;
  totalTasks: number;
};

export function getMinimumCorrectForNormal(totalTasks: number): number {
  return Math.ceil(totalTasks * NORMAL_ACCURACY_THRESHOLD);
}

export function calculateTaskAccuracy(correctTasks: number, totalTasks: number): number | null {
  return totalTasks > 0 ? correctTasks / totalTasks : null;
}

export function classifyParticipant({
  startedAt,
  completedAt,
  correctTasks,
  totalTasks,
}: ClassificationInput): ParticipantStatus {
  if (!startedAt) return null;
  if (!completedAt) return 'DROPOUT';
  return correctTasks >= getMinimumCorrectForNormal(totalTasks) ? 'NORMAL' : 'INATTENTIVE';
}
