declare module 'fairly-fast-formants' {
  export interface FormantAnalyzerOptions {
    model_order: number;
    window_length_s: number;
    sample_rate_hz: number;
    frequency_bins: number;
  }

  export interface Formant {
    time_step: number;
    bin_index: number;
    amplitude: number;
    frequency: number;
  }

  export interface Pole {
    time_step: number;
    imag: number;
    real: number;
    frequency: number;
    bandwidth: number;
  }

  export interface FormantAnalysisResult {
    valid_input: boolean;
    success: boolean;
    formants: Formant[];
    poles: Pole[];
  }

  export class FormantAnalyzer {
    constructor(options: FormantAnalyzerOptions);
    init(): Promise<void>;
    analyze(input: Float32Array): FormantAnalysisResult;
    destroy(): void;
  }
}
