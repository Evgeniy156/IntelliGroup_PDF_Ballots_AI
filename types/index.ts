
export interface BallotData {
  lastName: string;
  firstName: string;
  middleName: string;
  snils: string;
  address: string;
  roomNo: string;
  area: string;
  ownershipShare: string;
  ownershipType: string;
  regNumber: string;
  regDate: string;
  meetingDate: string;
  questionTexts: Record<string, string>;
  votes: Record<string, 'ЗА' | 'ПРОТИВ' | 'ВОЗДЕРЖАЛСЯ' | 'НЕ ГОЛОСОВАЛ'>;
}

export interface DocumentPage {
  id: string;
  sourceFile: string;
  pageNumber: number;
  imageData: string;
  rotation: number;
  extractedData?: Partial<BallotData>;
  qrData?: string;
  isStartPage?: boolean;
}

export interface GroupedDocument {
  id: string;
  name: string;
  snils?: string;
  pages: DocumentPage[];
  data: Partial<BallotData>;
  isVerified: boolean;
}

export interface ProcessingProgress {
  current: number;
  total: number;
  status: string;
}

export interface ApiSettings {
  provider: 'google' | 'openrouter';
  apiKey?: string;
  model: string;
}
