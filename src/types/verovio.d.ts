declare module 'verovio/wasm' {
  export default function createVerovioModule(options?: Record<string, unknown>): Promise<unknown>;
}
declare module 'verovio/esm' {
  export class VerovioToolkit {
    constructor(module: unknown);
    setOptions(options: Record<string, unknown>): void;
    loadData(data: string): number;
    getPageCount(): number;
    renderToSVG(page?: number, xmlDeclaration?: boolean): string;
    getLog(): string;
    destroy(): void;
  }
}
