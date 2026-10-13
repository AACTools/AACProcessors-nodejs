import { defaultFileAdapter } from '../../../utils/io';
import type { FileAdapter } from '../../../utils/io';
import { openSqliteDatabase } from '../../../utils/sqlite';
import type { SqliteDatabaseAdapter } from '../../../utils/sqlite';

export interface TDSnapLexiconForm {
  tag: string;
  form: string;
}

export interface TDSnapLexiconEntry {
  lexemeId: number;
  forms: TDSnapLexiconForm[];
}

export interface TDSnapLexiconData {
  locale: string;
  words: Map<string, TDSnapLexiconEntry>;
}

interface PosSubclassRow {
  Id: number;
  Name: string;
  PosClassId: number;
}

export class TDSnapLexiconParser {
  private fileAdapter: FileAdapter;

  constructor(fileAdapter: FileAdapter = defaultFileAdapter) {
    this.fileAdapter = fileAdapter;
  }

  async parseDb(dbPath: string, locale?: string): Promise<TDSnapLexiconData> {
    const detectedLocale = locale || this.inferLocale(dbPath);
    const { db, cleanup } = await openSqliteDatabase(dbPath, {
      readonly: true,
      fileAdapter: this.fileAdapter,
    });

    try {
      return this.extractAll(db, detectedLocale);
    } finally {
      if (cleanup) {
        await cleanup();
      } else {
        db.close();
      }
    }
  }

  private inferLocale(dbPath: string): string {
    const match = dbPath.match(/lang_([a-z]{2}_[A-Z]{2})/i);
    return match ? match[1] : 'unknown';
  }

  private extractAll(db: SqliteDatabaseAdapter, locale: string): TDSnapLexiconData {
    const words = new Map<string, TDSnapLexiconEntry>();
    const subclassCache = new Map<number, string>();

    const getSubclass = (id: number): string | undefined => {
      let name = subclassCache.get(id);
      if (name !== undefined) return name;
      const row = db.prepare('SELECT Name FROM PosSubclass WHERE Id = ?').get(id) as
        | PosSubclassRow
        | undefined;
      name = row?.Name;
      if (name) {
        subclassCache.set(id, name);
        return name;
      }
      return undefined;
    };

    const allWords = db
      .prepare(
        `SELECT w.Id as wordId, w.Text as text,
                i.Id as inflectionId, i.LexemeId as lexemeId, i.PosSubclassId as posSubclassId
         FROM Word w
         JOIN Spelling s ON s.WordId = w.Id
         JOIN Inflection i ON i.Id = s.InflectionId
         WHERE i.PosSubclassId != 0
         ORDER BY w.Text`
      )
      .all() as Array<{
      wordId: number;
      text: string;
      inflectionId: number;
      lexemeId: number;
      posSubclassId: number;
    }>;

    const lexemeForms = new Map<number, Map<string, string[]>>();

    for (const row of allWords) {
      const tag = getSubclass(row.posSubclassId);
      if (!tag) continue;

      let formsByTag = lexemeForms.get(row.lexemeId);
      if (!formsByTag) {
        formsByTag = new Map();
        lexemeForms.set(row.lexemeId, formsByTag);
      }

      const existing = formsByTag.get(tag);
      if (existing) {
        if (!existing.includes(row.text)) existing.push(row.text);
      } else {
        formsByTag.set(tag, [row.text]);
      }
    }

    const wordToLexeme = new Map<string, number>();
    for (const row of allWords) {
      if (!wordToLexeme.has(row.text.toLowerCase())) {
        wordToLexeme.set(row.text.toLowerCase(), row.lexemeId);
      }
    }

    for (const [text, lexemeId] of wordToLexeme) {
      const formsByTag = lexemeForms.get(lexemeId);
      if (!formsByTag || formsByTag.size === 0) continue;

      const forms: TDSnapLexiconForm[] = [];
      for (const [tag, formTexts] of formsByTag) {
        for (const formText of formTexts) {
          if (formText.toLowerCase() !== text) {
            forms.push({ tag, form: formText });
          }
        }
      }

      if (forms.length > 0) {
        words.set(text, { lexemeId, forms });
      }
    }

    return { locale, words };
  }

  lookupWord(data: TDSnapLexiconData, word: string): string[] {
    const entry = data.words.get(word.toLowerCase());
    if (!entry) return [];
    return entry.forms.map((f) => f.form);
  }

  lookupWordByTag(data: TDSnapLexiconData, word: string, tag: string): string[] {
    const entry = data.words.get(word.toLowerCase());
    if (!entry) return [];
    return entry.forms.filter((f) => f.tag === tag).map((f) => f.form);
  }

  static readonly TAG_TO_POS: Record<string, string> = {
    V0: 'Verb',
    VZ: 'Verb',
    VG: 'Verb',
    VD: 'Verb',
    VN: 'Verb',
    SNG: 'Noun',
    PLU: 'Noun',
    ADJ: 'Adjective',
    ADJR: 'Adjective',
    ADJT: 'Adjective',
    ADV: 'Adjective',
    SUB: 'Pronoun',
    OBJ: 'Pronoun',
    POS: 'Pronoun',
    NPOS: 'Pronoun',
    REF: 'Pronoun',
    B0: 'Verb',
    BZ: 'Verb',
    BM: 'Verb',
    BR: 'Verb',
    BDZ: 'Verb',
    BDR: 'Verb',
    BG: 'Verb',
    BN: 'Verb',
  };

  static readonly HANDLER_TAG_MAP: Record<string, string> = {
    'NOUN:PLU': 'PLU',
    'DESCRIBE:ADJR': 'ADJR',
    'DESCRIBE:ADJT': 'ADJT',
    'DESCRIBE:ADV': 'ADV',
    'VERB:V0': 'V0',
    'VERB:VZ': 'VZ',
    'VERB:VG': 'VG',
    'VERB:VD': 'VD',
    'VERB:VN': 'VN',
    'PRONOUN:SUB': 'SUB',
    'PRONOUN:OBJ': 'OBJ',
    'PRONOUN:POS': 'POS',
    'PRONOUN:NPOS': 'NPOS',
    'PRONOUN:REF': 'REF',
    'BE:B0': 'B0',
    'BE:BZ': 'BZ',
    'BE:BM': 'BM',
    'BE:BR': 'BR',
    'BE:BDZ': 'BDZ',
    'BE:BDR': 'BDR',
    'BE:BG': 'BG',
    'BE:BN': 'BN',
  };

  static parseContentTypeHandler(
    handler: string
  ): { category: string; subtype: string; params: string[] } | null {
    if (!handler) return null;
    const colonIdx = handler.indexOf(':');
    if (colonIdx === -1) {
      const parts = handler.split(',');
      return { category: parts[0], subtype: '', params: parts.slice(1) };
    }
    const category = handler.substring(0, colonIdx);
    const rest = handler.substring(colonIdx + 1);
    const commaIdx = rest.indexOf(',');
    if (commaIdx === -1) {
      return { category, subtype: rest, params: [] };
    }
    const subtype = rest.substring(0, commaIdx);
    const paramsStr = rest.substring(commaIdx + 1);
    const params = paramsStr.split(',').map((p) => p.trim());
    return { category, subtype, params };
  }

  static tagToPos(tag: string): string {
    return TDSnapLexiconParser.TAG_TO_POS[tag] || 'Unknown';
  }

  static handlerToPos(handler: string): string {
    const parsed = TDSnapLexiconParser.parseContentTypeHandler(handler);
    if (!parsed) return 'Unknown';
    if (parsed.category === 'RESET' || parsed.category === 'SPECIAL') return 'Ignore';
    const key = `${parsed.category}:${parsed.subtype}`;
    const tag = TDSnapLexiconParser.HANDLER_TAG_MAP[key];
    if (tag) return TDSnapLexiconParser.TAG_TO_POS[tag] || 'Unknown';
    return TDSnapLexiconParser.TAG_TO_POS[parsed.subtype] || 'Unknown';
  }
}
