export type SessionStatus = 'opened' | 'started' | 'completed';

export type CurrentTask = {
  receiptId: string;
  imageUrl: string;
  question: string;
  presentationIndex: number;
  shownAt: string;
};

export type CurrentTaskResponse = {
  status: SessionStatus;
  currentIndex: number;
  totalTasks: number;
  completed: boolean;
  elapsedTimeSeconds: number | null;
  timeLimitExceeded: boolean;
  timeRemainingSeconds: number | null;
  task: CurrentTask | null;
};
