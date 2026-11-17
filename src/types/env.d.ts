/** Build-time flags WXT inlines per target browser; undefined in unit tests. */
interface ImportMetaEnv {
  readonly FIREFOX?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
