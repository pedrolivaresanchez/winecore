// Conector regulatorio. SILICIE, en este hito, es manual: WineCore no llama a la AEAT.
import { domainError } from "../errors";
import type { Issue } from "./issue";

export type RegulatoryFlow =
  | "verifactu"
  | "silicie"
  | "sisv"
  | "emcs"
  | "edi"
  | "organic"
  | "aeat_model";

export type ConnectorMode = "manual" | "computer_use" | "api";

export interface RenderedFile {
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface Rendered {
  files: readonly RenderedFile[];
}

export interface ConnectorRunRef {
  submissionId: string;
  attempt: number;
  action: "submit" | "check_status" | "fetch_receipt" | "read_inbox" | "cancel";
}

export interface RegulatoryConnector<P> {
  flow: RegulatoryFlow;
  mode: ConnectorMode;
  validate(payload: P): Issue[];
  render(payload: P): Promise<Rendered>;
  /** No debe llamar a la red. El modo manual rechaza el envío automático. */
  submit(run: ConnectorRunRef): Promise<void>;
}

export interface SilicieConnectorInput {
  issues: readonly Issue[];
  files: readonly RenderedFile[];
}

export class ManualSilicieConnector implements RegulatoryConnector<SilicieConnectorInput> {
  readonly flow = "silicie" as const;
  readonly mode = "manual" as const;

  validate(payload: SilicieConnectorInput): Issue[] {
    return [...payload.issues];
  }

  render(payload: SilicieConnectorInput): Promise<Rendered> {
    return Promise.resolve({ files: payload.files });
  }

  submit(_run: ConnectorRunRef): Promise<void> {
    return Promise.reject(
      domainError(
        "WC_ILLEGAL_TRANSITION",
        {
          submit:
            "WineCore no envía el fichero a la AEAT. Descárgalo, preséntalo en la sede y márcalo como presentado.",
        },
      ),
    );
  }
}

export const manualSilicieConnector = new ManualSilicieConnector();
