export interface WordValidator {
  isWordValid(word: string): Promise<boolean>;
}

export class WordValidatorStub implements WordValidator {
  async isWordValid(_word: string): Promise<boolean> {
    // Stub always returns true. Replace with a real implementation if needed.
    return true;
  }
}

export class WordValidatorHttp implements WordValidator {
  private cache = new Map<string, boolean>();
  constructor(private baseUrl: string, private apiKey?: string, private timeoutMs = 1500) {}

  async isWordValid(word: string): Promise<boolean> {
    const key = word.toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key)!;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = `${this.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        this.cache.set(key, false);
        return false;
      }
      const ok = true; // assume 200 means valid
      this.cache.set(key, ok);
      return ok;
    } catch (e) {
      // Timeout or network error → consider invalid or handle gracefully
      this.cache.set(key, false);
      return false;
    } finally {
      clearTimeout(id);
    }
  }
}

// Load a dictionary file (one word per line) and validate words against it.
// Supports wildcard '?' in the queried word (matches any single A-Z letter).
export class WordValidatorFile implements WordValidator {
  private byLength: Map<number, string[]> = new Map();
  private ready = false;

  constructor(filePath: string) {
    try {
      // Load synchronously at startup to keep logic simple
      const fs = require('node:fs');
      const raw: string = fs.readFileSync(filePath, 'utf8');
      const words = raw
        .split(/\r?\n/)
        .map((w: string) => w.trim())
        .filter((w: string) => w.length > 0)
        .map((w: string) => w.toUpperCase());
      for (const w of words) {
        const len = w.length;
        const arr = this.byLength.get(len) || [];
        arr.push(w);
        this.byLength.set(len, arr);
      }
      this.ready = true;
      console.log(`[dict] Loaded ${words.length} words from ${filePath}`);
    } catch (e) {
      console.warn(`[dict] Failed to load dictionary at ${filePath}:`, e?.message || e);
      this.ready = false;
    }
  }

  async isWordValid(word: string): Promise<boolean> {
    if (!this.ready) return false;
    const W = (word || '').toUpperCase();
    const pool = this.byLength.get(W.length);
    if (!pool) return false;
    if (!W.includes('?')) {
      // Exact lookup
      // Use a small linear search; could be optimized with a Set per length if needed
      for (const v of pool) if (v === W) return true;
      return false;
    }
    // Wildcard match: '?' matches any single A-Z letter
    // Precompute indices of wildcards
    const wcIdx: number[] = [];
    for (let i = 0; i < W.length; i++) if (W[i] === '?') wcIdx.push(i);
    outer: for (const v of pool) {
      // Quick checks: all non-wildcard positions must match
      for (let i = 0; i < W.length; i++) {
        const c = W[i];
        if (c === '?') continue;
        if (v[i] !== c) continue outer;
      }
      return true;
    }
    return false;
  }
}
