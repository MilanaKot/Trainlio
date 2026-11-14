'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { rotateJoinCode } from '@/server/club/actions'
import { Button, buttonVariants } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'

const t = messages.access

/**
 * The club's link and QR code (`Přístup do klubu`). The QR code is drawn on
 * the server from the link and nothing else, so it is inserted as markup; it
 * can be downloaded as an SVG for a poster, which prints sharp at any size.
 */
export function JoinLinkPanel({
  workspaceId,
  url,
  qrSvg,
  clubName,
  rotatedLabel,
}: {
  workspaceId: string
  url: string
  qrSvg: string
  clubName: string
  rotatedLabel: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast(t.copied)
    } catch {
      // A browser that refuses the clipboard still shows the link to select.
    }
  }

  function rotate() {
    startTransition(async () => {
      const result = await rotateJoinCode(workspaceId)
      setConfirming(false)
      toast(result.ok ? t.rotated : messages.club.errors.generic)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col items-center gap-4 rounded-card bg-surface p-5 shadow-card">
        <div
          role="img"
          aria-label={t.qrAlt}
          className="size-56 [&>svg]:size-full"
          // Generated on the server by `qrcode` from the club's own link.
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
        <p className="text-center text-row font-bold text-ink">{clubName}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-caption font-bold tracking-[0.05em] text-muted">{t.linkCaption}</h2>
        <p className="break-all rounded-control bg-surface px-3.5 py-3 text-row text-ink shadow-card select-all">
          {url}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button size="lg" variant="secondary" onClick={copy}>
            {t.copy}
          </Button>
          <a
            href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`}
            download="qr-klub.svg"
            className={buttonVariants({ size: 'lg', variant: 'outline' })}
          >
            {t.download}
          </a>
        </div>
      </section>

      <div className="flex flex-col gap-1.5">
        <Button size="lg" variant="danger-outline" onClick={() => setConfirming(true)}>
          {t.rotate}
        </Button>
        {rotatedLabel ? <p className="text-center text-hint text-muted">{rotatedLabel}</p> : null}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t.rotateTitle}
        description={t.rotateBody}
        tone="warning"
        cancelLabel={messages.common.cancel}
        confirmLabel={t.rotateConfirm}
        onConfirm={rotate}
        pending={pending}
      />
    </div>
  )
}
