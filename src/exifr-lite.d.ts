declare module 'exifr/dist/lite.esm.mjs' {
  interface ExifrParseOptions {
    reviveValues?: boolean;
    pick?: string[];
  }

  export function parse(data: Blob, options?: ExifrParseOptions): Promise<unknown>;

  const exifr: {
    parse: typeof parse;
  };

  export default exifr;
}
