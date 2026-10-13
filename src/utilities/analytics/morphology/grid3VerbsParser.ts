import { XMLParser } from 'fast-xml-parser';
import { defaultFileAdapter, getNodeRequire } from '../../../utils/io';
import type { VerbFormWithConditions, Grid3VerbFormsDetailed } from './types';

// Resolve path helpers through the file adapter (lazily) so this module never
// statically imports Node's `path` module, which React Native/Metro cannot bundle.
const { join, dirname, basename } = defaultFileAdapter;

// `adm-zip` depends on Node's `path`, so load it lazily to keep this module
// bundleable in browser/React Native environments (where only parseXml is used).
function loadAdmZip(): typeof import('adm-zip') {
  return getNodeRequire()('adm-zip') as typeof import('adm-zip');
}

export interface Grid3VerbForms {
  locale: string;
  verbs: Map<string, string[]>;
}

interface ParsedRuleSet {
  id: string;
  placeholders: string[];
  participleRules: Map<string, string>;
  conjugationRules: Array<{ value: string; conditions: Map<string, string> }>;
}

interface ParsedVerb {
  root: string;
  ruleId?: string;
  placeholderValues: Map<string, string>;
  participleOverrides: Map<string, string>;
  conjugationOverrides: Array<{
    value: string;
    conditions: Map<string, string>;
  }>;
}

export class Grid3VerbsParser {
  private parser = new XMLParser({
    ignoreAttributes: false,
    ignoreDeclaration: true,
    textNodeName: '#text',
  });

  parseXml(xmlContent: string, locale?: string): Grid3VerbForms {
    const data = this.parser.parse(xmlContent);
    const verbdata = data.verbdata || data.Verbdata;
    if (!verbdata) {
      return { locale: locale || 'unknown', verbs: new Map() };
    }

    const detectedLocale = verbdata['@_locale'] || verbdata.locale || locale || 'unknown';
    const ruleSets = this.parseRuleSets(verbdata);
    const verbs = this.parseVerbs(verbdata);
    const result = new Map<string, string[]>();

    for (const verb of verbs) {
      const forms = this.generateForms(verb, ruleSets);
      if (forms.length > 0) {
        result.set(verb.root, forms);
      }
    }

    return { locale: detectedLocale, verbs: result };
  }

  parseXmlDetailed(xmlContent: string, locale?: string): Grid3VerbFormsDetailed {
    const data = this.parser.parse(xmlContent);
    const verbdata = data.verbdata || data.Verbdata;
    if (!verbdata) {
      return { locale: locale || 'unknown', verbs: new Map() };
    }

    const detectedLocale = verbdata['@_locale'] || verbdata.locale || locale || 'unknown';
    const ruleSets = this.parseRuleSets(verbdata);
    const verbs = this.parseVerbs(verbdata);
    const result = new Map<string, VerbFormWithConditions[]>();

    for (const verb of verbs) {
      const forms = this.generateFormsDetailed(verb, ruleSets);
      if (forms.length > 0) {
        result.set(verb.root, forms);
      }
    }

    return { locale: detectedLocale, verbs: result };
  }

  parseXmlFileDetailed(filePath: string): Grid3VerbFormsDetailed {
    const fs = getNodeRequire()('fs') as typeof import('fs');
    const xml = fs.readFileSync(filePath, 'utf-8');
    return this.parseXmlDetailed(xml);
  }

  parseZip(zipPath: string): Grid3VerbForms {
    const AdmZip = loadAdmZip();
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    const verbEntry = entries.find((e) => e.entryName.toLowerCase().endsWith('verbs.xml'));
    if (!verbEntry) {
      const locale = basename(dirname(zipPath));
      return { locale, verbs: new Map() };
    }
    const xml = verbEntry.getData().toString('utf-8');
    return this.parseXml(xml);
  }

  parseZipDetailed(zipPath: string): Grid3VerbFormsDetailed {
    const AdmZip = loadAdmZip();
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    const verbEntry = entries.find((e) => e.entryName.toLowerCase().endsWith('verbs.xml'));
    if (!verbEntry) {
      const locale = basename(dirname(zipPath));
      return { locale, verbs: new Map() };
    }
    const xml = verbEntry.getData().toString('utf-8');
    return this.parseXmlDetailed(xml);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async parseLocale(locale: string, grid3InstallPath?: string): Promise<Grid3VerbForms> {
    const installPath = grid3InstallPath || this.getDefaultInstallPath();
    if (!installPath) {
      return { locale, verbs: new Map() };
    }
    const zipPath = join(installPath, 'Locale', locale, 'verbs', 'verbs.zip');
    try {
      return this.parseZip(zipPath);
    } catch {
      return { locale, verbs: new Map() };
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async parseInstalledLocales(grid3InstallPath?: string): Promise<Map<string, Grid3VerbForms>> {
    const installPath = grid3InstallPath || this.getDefaultInstallPath();
    const results = new Map<string, Grid3VerbForms>();
    if (!installPath) return results;

    const fs = getNodeRequire()('fs') as typeof import('fs');
    const localeDir = join(installPath, 'Locale');
    let locales: string[];
    try {
      locales = fs
        .readdirSync(localeDir)
        .filter((d) => fs.statSync(join(localeDir, d)).isDirectory());
    } catch {
      return results;
    }

    for (const locale of locales) {
      const verbsZip = join(localeDir, locale, 'verbs', 'verbs.zip');
      try {
        fs.accessSync(verbsZip, fs.constants.R_OK);
        const forms = this.parseZip(verbsZip);
        results.set(locale, forms);
      } catch {
        // No verbs.zip for this locale
      }
    }

    return results;
  }

  /**
   * Parse all locales from a custom directory.
   *
   * The directory should have the same structure as Grid 3's Locale folder:
   *   customDir/en-GB/verbs/verbs.zip
   *   customDir/nb-NO/verbs/verbs.zip
   *   customDir/de-DE/verbs/verbs.zip
   *
   * This allows users to supply morphology data copied from any Grid 3
   * installation without needing Grid 3 installed on this machine.
   */
  parseCustomDirectory(dirPath: string, detailed?: false): Map<string, Grid3VerbForms>;
  parseCustomDirectory(
    dirPath: string,
    detailed: true
  ): Map<string, import('./types').Grid3VerbFormsDetailed>;
  parseCustomDirectory(
    dirPath: string,
    detailed = false
  ): Map<string, Grid3VerbForms> | Map<string, import('./types').Grid3VerbFormsDetailed> {
    /* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
    const fs = getNodeRequire()('fs') as typeof import('fs');
    let locales: string[];
    try {
      locales = fs
        .readdirSync(dirPath)
        .filter((d: string) => fs.statSync(join(dirPath, d)).isDirectory());
    } catch {
      return new Map();
    }

    if (detailed) {
      const results = new Map<string, import('./types').Grid3VerbFormsDetailed>();
      for (const locale of locales) {
        const verbsZip = join(dirPath, locale, 'verbs', 'verbs.zip');
        try {
          fs.accessSync(verbsZip, fs.constants.R_OK);
          results.set(locale, this.parseZipDetailed(verbsZip));
        } catch {
          // No verbs.zip for this locale
        }
      }
      return results;
    }

    const results = new Map<string, Grid3VerbForms>();
    for (const locale of locales) {
      const verbsZip = join(dirPath, locale, 'verbs', 'verbs.zip');
      try {
        fs.accessSync(verbsZip, fs.constants.R_OK);
        results.set(locale, this.parseZip(verbsZip));
      } catch {
        // No verbs.zip for this locale
      }
    }
    return results;
    /* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
  }

  private getDefaultInstallPath(): string | null {
    if (typeof process === 'undefined' || process.platform !== 'win32') {
      return null;
    }
    const paths = [
      'C:\\Program Files (x86)\\Smartbox\\Grid 3',
      'C:\\Program Files\\Smartbox\\Grid 3',
    ];
    try {
      const fs = getNodeRequire()('fs') as typeof import('fs');
      for (const p of paths) {
        if (fs.existsSync(p)) return p;
      }
    } catch {
      // Grid 3 not installed
    }
    return null;
  }

  /* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
  private parseRuleSets(verbdata: any): Map<string, ParsedRuleSet> {
    const rulesMap = new Map<string, ParsedRuleSet>();
    const rulesList = verbdata.verbruleslist?.verbrules;
    if (!rulesList) return rulesMap;

    const rulesArr = Array.isArray(rulesList) ? rulesList : [rulesList];
    for (const rules of rulesArr) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const id = rules.Id || rules.id || `rule_${rulesMap.size}`;
      const placeholders: string[] = [];
      const ph = rules.placeholders?.placeholder;
      if (ph) {
        const phArr = Array.isArray(ph) ? ph : [ph];
        for (const p of phArr) {
          const val = typeof p === 'string' ? p : p['#text'] || p;
          if (val) placeholders.push(val);
        }
      }

      const participleRules = new Map<string, string>();
      const pr = rules.participlerules?.participlerule;
      if (pr) {
        const prArr = Array.isArray(pr) ? pr : [pr];
        for (const rule of prArr) {
          const type = rule['@_type'] || rule.type;
          const value = rule['@_value'] || rule.value;
          if (type && value) {
            participleRules.set(type, value);
          }
        }
      }

      const conjugationRules: Array<{
        value: string;
        conditions: Map<string, string>;
      }> = [];
      const cr = rules.conjugationrules?.conjugationrule;
      if (cr) {
        const crArr = Array.isArray(cr) ? cr : [cr];
        for (const rule of crArr) {
          const value = rule['@_value'] || rule.value;
          if (!value) continue;
          const conditions = new Map<string, string>();
          for (const attr of [
            'time',
            'number',
            'person',
            'aspect',
            'mood',
            'voice',
            'tense',
            'polarity',
          ]) {
            const v = rule[`@_${attr}`] || rule[attr];
            if (v && v !== '*') {
              conditions.set(attr, String(v));
            }
          }
          conjugationRules.push({ value, conditions });
        }
      }

      rulesMap.set(id, { id, placeholders, participleRules, conjugationRules });
    }

    return rulesMap;
  }

  /* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
  private parseVerbs(verbdata: any): ParsedVerb[] {
    const verbs: ParsedVerb[] = [];
    const verbsData = verbdata.verbs?.verb;
    if (!verbsData) return verbs;

    const arr = Array.isArray(verbsData) ? verbsData : [verbsData];
    for (const v of arr) {
      const root = v['@_root'] || v.root;
      if (!root) continue;

      const ruleId = v['@_ruleid'] || v.ruleid || undefined;

      const placeholderValues = new Map<string, string>();
      const rphv = v.ruleplaceholdervalues?.ruleplaceholdervalue;
      if (rphv) {
        const rphvArr = Array.isArray(rphv) ? rphv : [rphv];
        for (const ph of rphvArr) {
          const placeholder = ph['@_placeholder'] || ph.placeholder;
          const value = ph['@_value'] || ph.value;
          if (placeholder && value) {
            placeholderValues.set(placeholder, value);
          }
        }
      }

      const participleOverrides = new Map<string, string>();
      const parts = v.participles?.participle;
      if (parts) {
        const partsArr = Array.isArray(parts) ? parts : [parts];
        for (const p of partsArr) {
          const type = p['@_type'] || p.type;
          const value = p['@_value'] || p.value;
          if (type && value) {
            participleOverrides.set(type, value);
          }
        }
      }

      const conjugationOverrides: Array<{
        value: string;
        conditions: Map<string, string>;
      }> = [];
      const conjs = v.conjugations?.conjugation;
      if (conjs) {
        const conjArr = Array.isArray(conjs) ? conjs : [conjs];
        for (const c of conjArr) {
          const value = c['@_value'] || c.value;
          if (!value) continue;
          const conditions = new Map<string, string>();
          const parts2 = c.part;
          if (parts2) {
            const pArr = Array.isArray(parts2) ? parts2 : [parts2];
            for (const p of pArr) {
              for (const attr of ['time', 'number', 'person', 'aspect', 'mood', 'voice']) {
                const pv = p[`@_${attr}`] || p[attr];
                if (pv && pv !== '*') {
                  conditions.set(attr, String(pv));
                }
              }
            }
          }
          conjugationOverrides.push({ value, conditions });
        }
      }

      verbs.push({
        root,
        ruleId,
        placeholderValues,
        participleOverrides,
        conjugationOverrides,
      });
    }

    return verbs;
  }

  private generateForms(verb: ParsedVerb, ruleSets: Map<string, ParsedRuleSet>): string[] {
    const forms = new Set<string>();
    const resolvedParticiples = new Map<string, string>();

    for (const [type, value] of verb.participleOverrides) {
      resolvedParticiples.set(type, value);
    }

    let appliedRule: ParsedRuleSet | undefined;

    if (verb.ruleId && ruleSets.has(verb.ruleId)) {
      appliedRule = ruleSets.get(verb.ruleId) as ParsedRuleSet;
    } else if (ruleSets.size > 0) {
      appliedRule = ruleSets.values().next().value;
    }

    if (appliedRule) {
      const context = this.buildContext(verb, resolvedParticiples);

      for (const [type, template] of appliedRule.participleRules) {
        if (!resolvedParticiples.has(type)) {
          const resolved = this.resolveTemplate(template, context);
          if (resolved) {
            resolvedParticiples.set(type, resolved);
          }
        }
      }

      const fullContext = this.buildContext(verb, resolvedParticiples);

      for (const conjRule of appliedRule.conjugationRules) {
        const resolved = this.resolveTemplate(conjRule.value, fullContext);
        this.addIfSingleWord(resolved, forms);
      }
    }

    for (const [, value] of resolvedParticiples) {
      this.addIfSingleWord(value, forms);
    }

    for (const conj of verb.conjugationOverrides) {
      this.addIfSingleWord(conj.value, forms);
    }

    forms.delete(verb.root);
    return Array.from(forms);
  }

  private generateFormsDetailed(
    verb: ParsedVerb,
    ruleSets: Map<string, ParsedRuleSet>
  ): VerbFormWithConditions[] {
    const forms = new Map<string, Map<string, string>>();
    const resolvedParticiples = new Map<string, string>();

    for (const [type, value] of verb.participleOverrides) {
      resolvedParticiples.set(type, value);
    }

    let appliedRule: ParsedRuleSet | undefined;

    if (verb.ruleId && ruleSets.has(verb.ruleId)) {
      appliedRule = ruleSets.get(verb.ruleId) as ParsedRuleSet;
    } else if (ruleSets.size > 0) {
      appliedRule = ruleSets.values().next().value;
    }

    if (appliedRule) {
      const context = this.buildContext(verb, resolvedParticiples);

      for (const [type, template] of appliedRule.participleRules) {
        if (!resolvedParticiples.has(type)) {
          const resolved = this.resolveTemplate(template, context);
          if (resolved) {
            resolvedParticiples.set(type, resolved);
          }
        }
      }

      const fullContext = this.buildContext(verb, resolvedParticiples);

      for (const conjRule of appliedRule.conjugationRules) {
        const resolved = this.resolveTemplate(conjRule.value, fullContext);
        if (resolved && !resolved.includes(' ') && resolved !== '-') {
          const trimmed = resolved.trim();
          if (trimmed.length > 0 && trimmed !== verb.root) {
            const existing = forms.get(trimmed);
            if (existing) {
              for (const [k, v] of conjRule.conditions) {
                existing.set(k, v);
              }
            } else {
              forms.set(trimmed, new Map(conjRule.conditions));
            }
          }
        }
      }
    }

    for (const [type, value] of resolvedParticiples) {
      if (!value.includes(' ') && value !== '-' && value.trim().length > 0 && value !== verb.root) {
        const conditions = forms.get(value) || new Map<string, string>();
        conditions.set('participleType', type);
        forms.set(value, conditions);
      }
    }

    for (const conj of verb.conjugationOverrides) {
      if (
        conj.value &&
        !conj.value.includes(' ') &&
        conj.value !== '-' &&
        conj.value.trim().length > 0 &&
        conj.value !== verb.root
      ) {
        const existing = forms.get(conj.value) || new Map<string, string>();
        for (const [k, v] of conj.conditions) {
          existing.set(k, v);
        }
        forms.set(conj.value, existing);
      }
    }

    forms.delete(verb.root);
    return Array.from(forms.entries()).map(([value, conditions]) => ({
      value,
      conditions,
    }));
  }

  private buildContext(
    verb: ParsedVerb,
    resolvedParticiples: Map<string, string>
  ): Map<string, string> {
    const context = new Map<string, string>();
    context.set('{root}', verb.root);
    for (const [key, value] of verb.placeholderValues) {
      context.set(key, value);
      if (!key.startsWith('{')) {
        context.set(`{${key}}`, value);
      }
    }
    for (const [type, value] of resolvedParticiples) {
      context.set(`{${type}}`, value);
    }
    return context;
  }

  private resolveTemplate(template: string, context: Map<string, string>): string {
    let result = template;
    for (const [key, value] of context) {
      const keyToReplace = key.startsWith('{') ? key : `{${key}}`;
      result = result.split(keyToReplace).join(value);
    }
    return result;
  }

  private addIfSingleWord(form: string, set: Set<string>): void {
    if (!form) return;
    if (form.includes(' ')) return;
    if (form === '-') return;
    const trimmed = form.trim();
    if (trimmed.length > 0) {
      set.add(trimmed);
    }
  }
}
