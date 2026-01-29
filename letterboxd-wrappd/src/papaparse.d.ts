declare module 'papaparse' {
  export interface ParseResult<T> {
    data: T[];
    errors: ParseError[];
    meta: {
      delimiter: string;
      linebreak: string;
      aborted: boolean;
      truncated: boolean;
      cursor: number;
    };
  }

  export interface ParseError {
    type: string;
    code: string;
    message: string;
    row: number;
  }

  export interface ParseConfig<T> {
    header?: boolean;
    skipEmptyLines?: boolean;
    complete?: (result: ParseResult<T>) => void;
    error?: (error: ParseError) => void;
  }

  export function parse<T = any>(
    input: File | string,
    config?: ParseConfig<T>
  ): ParseResult<T>;

  export function unparse(
    data: any[],
    config?: { columns?: string[]; header?: boolean }
  ): string;

  const Papa: {
    parse: typeof parse;
    unparse: typeof unparse;
  };

  export default Papa;
}
