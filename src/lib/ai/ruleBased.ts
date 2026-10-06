import type { Client, FollowUp, Need, Property } from '../../types';
import { LocalPersianParser } from '../parser';
import { findMatchesForNeed } from '../matching';
import { formatNumberFa, formatToman } from '../utils/persian';
import { PROPERTY_TYPE_LABELS, TRANSACTION_LABELS } from '../utils/labels';
import type { AIProvider, FollowUpSuggestion } from './provider';

/** Offline provider: templates over KNOWN data only. It states nothing it was not given. */
export class RuleBasedProvider implements AIProvider {
  readonly name = 'rule-based';
  private parser = new LocalPersianParser();

  parsePropertyText(text: string) {
    return this.parser.parsePropertyText(text);
  }

  async generateClientMessage({ client, property: p }: { client: Client; property: Property; need?: Need | null }): Promise<string> {
    const facts: string[] = [];
    if (p.area != null) facts.push(`متراژ: ${formatNumberFa(p.area)} متر`);
    if (p.bedrooms != null) facts.push(`${formatNumberFa(p.bedrooms)} خواب`);
    if (p.location) facts.push(`منطقه: ${p.location}`);
    if (p.transactionType === 'sale') {
      if (p.price != null) facts.push(`قیمت: ${formatToman(p.price)}`);
    } else {
      if (p.deposit != null) facts.push(`رهن: ${formatToman(p.deposit)}`);
      if (p.rent != null) facts.push(`اجاره: ${formatToman(p.rent)}`);
    }
    if (p.parking === true) facts.push('پارکینگ دارد');
    if (p.elevator === true) facts.push('آسانسور دارد');
    if (p.storage === true) facts.push('انباری دارد');
    return [
      `سلام ${client.name} عزیز،`,
      `یک فایل ${TRANSACTION_LABELS[p.transactionType]} (${PROPERTY_TYPE_LABELS[p.propertyType]}) به نظرم با نیاز شما هم‌خوان است:`,
      facts.length ? facts.map((f) => `• ${f}`).join('\n') : '',
      'اگر مایل باشید، برای بازدید هماهنگ کنیم.',
    ].filter(Boolean).join('\n');
  }

  async summarizeClient({ client, needs, followUps }: { client: Client; needs: Need[]; followUps: FollowUp[] }): Promise<string> {
    const pending = followUps.filter((f) => f.status === 'pending').length;
    return `${client.name}: ${formatNumberFa(needs.length)} نیاز ثبت‌شده و ${formatNumberFa(pending)} پیگیری باز.`;
  }

  async suggestFollowUps({ client, needs, properties, followUps }: { client: Client; needs: Need[]; properties: Property[]; followUps: FollowUp[] }): Promise<FollowUpSuggestion[]> {
    const out: FollowUpSuggestion[] = [];
    if (needs.length === 0) {
      out.push({ title: `ثبت نیاز ${client.name}`, reason: 'برای این مشتری هنوز نیازی ثبت نشده است.', propertyId: null });
      return out;
    }
    const alreadyLinked = new Set(followUps.filter((f) => f.status === 'pending' && f.propertyId).map((f) => f.propertyId));
    for (const need of needs) {
      const best = findMatchesForNeed(need, properties, 60)[0];
      if (best && !alreadyLinked.has(best.propertyId)) {
        const p = properties.find((x) => x.id === best.propertyId);
        if (p) out.push({ title: `ارسال فایل «${p.title}» به ${client.name}`, reason: `امتیاز تطبیق مبتنی بر قوانین: ${formatNumberFa(best.score)}٪`, propertyId: p.id });
      }
    }
    if (out.length === 0) out.push({ title: `تماس با ${client.name} برای به‌روزرسانی نیاز`, reason: 'فایل مناسبی برای نیازهای فعلی پیدا نشد.', propertyId: null });
    return out;
  }
}
