'use client';
import { useRouter } from 'next/navigation';
import { PageHeader, Section } from '@/components/ui';
import { SmartEntry } from '@/features/properties/SmartEntry';
import { MessageDrafter } from '@/features/assistant/MessageDrafter';
import { FollowUpSuggestions } from '@/features/assistant/FollowUpSuggestions';

export default function AssistantPage() {
  const router = useRouter();
  return (
    <>
      <PageHeader title="دستیار" subtitle="کارهای تکراری را به رهیار بسپارید؛ هر چیزی که ثبت شود اول به تأیید شما می‌رسد." />
      <Section title="ثبت هوشمند فایل"><SmartEntry onSaved={(p) => router.push(`/properties/view/?id=${encodeURIComponent(p.id)}`)} /></Section>
      <Section><MessageDrafter /></Section>
      <Section><FollowUpSuggestions /></Section>
    </>
  );
}
