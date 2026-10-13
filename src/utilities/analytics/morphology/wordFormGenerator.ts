import { MorphologyEngine } from './engine';
import { Grid3VerbsParser } from './grid3VerbsParser';
import type { AstericsWordForm, VerbFormWithConditions } from './types';

const SLOT_TAG_MAP: Record<string, string[]> = {
  '3sg': ['3.PERS'],
  past: ['PAST'],
  pastPart: ['PAST', 'PARTICIPLE'],
  presPart: ['GERUND'],
  plural: ['PLURAL'],
  comparative: ['COMPARATIVE'],
  superlative: ['SUPERLATIVE'],
};

const CONDITION_TAG_MAP: Record<string, Record<string, string[]>> = {
  person: { first: ['1.PERS'], second: ['2.PERS'], third: ['3.PERS'] },
  number: { singular: [], plural: ['PLURAL'] },
  time: { present: ['PRESENT'], past: ['PAST'], future: ['FUTURE'] },
  aspect: { simple: [], continuous: ['CONTINUOUS'], perfect: ['PERFECT'] },
  mood: {
    imperative: ['IMPERATIVE'],
    indicative: [],
    conditional: ['CONDITIONAL'],
  },
  participleType: {
    presentparticiple: ['GERUND'],
    pastparticiple: ['PAST', 'PARTICIPLE'],
    infinitive: ['BASE'],
  },
};

export class WordFormGenerator {
  generateFromEngineSlots(
    base: string,
    pos: string,
    engine: MorphologyEngine,
    lang: string = 'en'
  ): AstericsWordForm[] {
    const forms = engine.inflectWithSlots(base, pos);
    const result: AstericsWordForm[] = [{ lang, tags: ['BASE'], value: base }];

    for (const { slot, form } of forms) {
      const tags = SLOT_TAG_MAP[slot] || [slot.toUpperCase()];
      result.push({ lang, tags, value: form, base });
    }

    return result;
  }

  generateFromGrid3Conditions(
    base: string,
    formsWithConditions: VerbFormWithConditions[],
    lang: string = 'en'
  ): AstericsWordForm[] {
    const result: AstericsWordForm[] = [{ lang, tags: ['BASE'], value: base }];

    for (const form of formsWithConditions) {
      const tags = this.conditionsToTags(form.conditions);
      result.push({ lang, tags, value: form.value, base });
    }

    return this.deduplicate(result);
  }

  async generateFromPos(
    base: string,
    pos: string,
    engine: MorphologyEngine,
    grid3Parser: Grid3VerbsParser,
    verbsZipPath?: string,
    lang: string = 'en'
  ): Promise<AstericsWordForm[]> {
    if (verbsZipPath) {
      const detailed = await grid3Parser.parseZipDetailed(verbsZipPath);
      const forms = detailed.verbs.get(base) || detailed.verbs.get(base.toLowerCase());
      if (forms && forms.length > 0) {
        return this.generateFromGrid3Conditions(base, forms, lang);
      }
    }

    return this.generateFromEngineSlots(base, pos, engine, lang);
  }

  conditionsToTags(conditions: Map<string, string>): string[] {
    const tags: string[] = [];
    for (const [dim, value] of conditions) {
      const mapped = CONDITION_TAG_MAP[dim]?.[value];
      if (mapped) {
        tags.push(...mapped);
      }
    }
    return tags.length > 0 ? tags : ['UNKNOWN'];
  }

  private deduplicate(forms: AstericsWordForm[]): AstericsWordForm[] {
    const seen = new Set<string>();
    return forms.filter((f) => {
      const key = `${f.value}|${f.tags.sort().join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
