import type { AccountType } from '@miden-sdk/miden-sdk';

export interface MidenClientOpts {
  endpoint?: string;
  noteTransportUrl?: string;
  /**
   * @deprecated Use noteTransportUrl instead
   */
  nodeTransportUrl?: string;
  seed?: string;
}

export type MidenAccountStorageMode = 'public' | 'private' | 'network';

export interface MidenAccountOpts {
  accountSeed?: string;
  type: AccountType;
  storageMode: MidenAccountStorageMode;
}
export type Opts = MidenClientOpts & MidenAccountOpts;

interface NoteIdAndAsset {
  id: string;
  assets: {
    assetId: string;
    amount: string;
  }[];
}

interface InputNoteSender {
  sender: string;
}

interface OutputNoteType {
  noteType: string;
}

export interface TxSummaryJson {
  inputNotes: (NoteIdAndAsset & InputNoteSender)[];
  outputNotes: (NoteIdAndAsset & OutputNoteType)[];
}
