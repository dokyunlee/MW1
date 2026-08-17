import { ReceiptTaskApp } from '@/components/receipt-task-app';

export const dynamic = 'force-dynamic';

function getGoogleFormUrl(): string | undefined {
  const value = process.env.GOOGLE_FORM_URL?.trim();
  if (!value) return undefined;

  try {
    const url = new URL(value);
    const isGoogleForm =
      url.protocol === 'https:' &&
      (url.hostname === 'forms.gle' ||
        (url.hostname === 'docs.google.com' && url.pathname.startsWith('/forms/')));
    return isGoogleForm ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export default function Home() {
  return <ReceiptTaskApp googleFormUrl={getGoogleFormUrl()} />;
}
