/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_TITLE?: string;
  readonly VITE_APP_PORT?: string;
  readonly VITE_AUTH_ENABLED?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_TIMBAL_BASE_URL?: string;
  readonly VITE_TIMBAL_ORG_ID?: string;
  readonly VITE_TIMBAL_PROJECT_ID?: string;
  readonly VITE_AUTH_TIMBAL_IAM?: string;
  readonly VITE_ASSISTANT_WORKFORCE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
