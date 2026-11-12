import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PhotoField } from '@/components/athlete/photo-field'

const uploaded: FormData[] = []
const upload = vi.fn(async (_athleteId: string, form: FormData) => {
  uploaded.push(form)
  return { ok: true as const }
})

vi.mock('@/server/athletes/actions', () => ({
  uploadAthletePhoto: (athleteId: string, form: FormData) => upload(athleteId, form),
  removeAthletePhoto: async () => ({ ok: true }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}))

// The real one carries libheif. What matters here is that the field loads it
// only for a HEIC, waits for it, and sends on what it returns.
const convert = vi.fn(
  async (file: File) =>
    new File(['jpeg-bytes'], file.name.replace(/\.heic$/i, '.jpg'), {
      type: 'image/jpeg',
    }),
)
vi.mock('@/lib/photo/heic', () => ({
  heicToJpeg: (file: File) => convert(file),
}))

// jsdom draws nothing, so the resize is stood in for: what is checked is that
// every photograph passes through it and that what it returns is what is sent.
const shrink = vi.fn(async (file: File) => file)
vi.mock('@/lib/photo/shrink', () => ({
  shrinkPhoto: (file: File) => shrink(file),
}))

// jsdom has no object URLs; the preview needs one that next/image accepts.
URL.createObjectURL = () => 'blob:http://localhost/preview'
URL.revokeObjectURL = () => undefined

function heic(bytes = 1024): File {
  return new File([new Uint8Array(bytes)], 'IMG_0421.HEIC', { type: '' })
}

beforeEach(() => {
  uploaded.length = 0
  upload.mockClear()
  convert.mockClear()
  shrink.mockClear()
})

/** DR-13 / AC-282: the format every iPhone takes, accepted and converted. */
describe('a photograph from an iPhone (AC-282)', () => {
  it('converts a HEIC and uploads the JPEG', async () => {
    render(<PhotoField athleteId="a1" photoUrl={null} />)

    const input = screen.getByLabelText('Nahrát fotografii')
    await userEvent.upload(input, heic())

    await waitFor(() => expect(upload).toHaveBeenCalledOnce())
    expect(convert).toHaveBeenCalledOnce()

    const sent = uploaded[0]?.get('photo')
    expect(sent).toBeInstanceOf(File)
    expect((sent as File).type).toBe('image/jpeg')
  })

  it('sends a JPEG straight on, without loading the converter', async () => {
    render(<PhotoField athleteId="a1" photoUrl={null} />)

    await userEvent.upload(
      screen.getByLabelText('Nahrát fotografii'),
      new File(['x'], 'foto.jpg', { type: 'image/jpeg' }),
    )

    await waitFor(() => expect(upload).toHaveBeenCalledOnce())
    expect(convert).not.toHaveBeenCalled()
  })

  // §G9: the limit is about the file the parent picked, so a 6 MB HEIC is
  // refused before anything is decoded rather than after.
  it('refuses an oversized HEIC before converting it', async () => {
    render(<PhotoField athleteId="a1" photoUrl={null} />)

    await userEvent.upload(screen.getByLabelText('Nahrát fotografii'), heic(6 * 1024 * 1024))

    expect(await screen.findByRole('alert')).toHaveTextContent('Fotografie je větší než 5 MB.')
    expect(convert).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it('says what to do when the conversion fails', async () => {
    convert.mockRejectedValueOnce(new Error('libheif said no'))
    render(<PhotoField athleteId="a1" photoUrl={null} />)

    await userEvent.upload(screen.getByLabelText('Nahrát fotografii'), heic())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Fotku se nepodařilo převést. Zkuste ji nahrát jako JPG.',
    )
    expect(upload).not.toHaveBeenCalled()
  })

  it('tells the parent what it is doing while it runs', async () => {
    let release: (file: File) => void = () => undefined
    convert.mockImplementationOnce(() => new Promise<File>((resolve) => (release = resolve)))

    render(<PhotoField athleteId="a1" photoUrl={null} />)
    await userEvent.upload(screen.getByLabelText('Nahrát fotografii'), heic())

    expect(await screen.findByText('Převádím fotku…')).toBeInTheDocument()
    release(new File(['x'], 'IMG_0421.jpg', { type: 'image/jpeg' }))
    await waitFor(() => expect(upload).toHaveBeenCalledOnce())
  })
})

/**
 * §G9 asks for the resize, and the action body needs it: Next refuses a Server
 * Action over 1 MB, so a phone's 3 MB JPEG sent as it is never arrives.
 */
describe('a photograph sized to send', () => {
  it('sends what the resize returns', async () => {
    const small = new File(['small'], 'foto.jpg', { type: 'image/jpeg' })
    shrink.mockResolvedValueOnce(small)
    render(<PhotoField athleteId="a1" photoUrl={null} />)

    await userEvent.upload(
      screen.getByLabelText('Nahrát fotografii'),
      new File([new Uint8Array(3 * 1024 * 1024)], 'foto.jpg', { type: 'image/jpeg' }),
    )

    await waitFor(() => expect(upload).toHaveBeenCalledOnce())
    expect(uploaded[0]?.get('photo')).toBe(small)
  })

  it('refuses a JPEG over 5 MB before touching it', async () => {
    render(<PhotoField athleteId="a1" photoUrl={null} />)

    await userEvent.upload(
      screen.getByLabelText('Nahrát fotografii'),
      new File([new Uint8Array(6 * 1024 * 1024)], 'foto.jpg', { type: 'image/jpeg' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Fotografie je větší než 5 MB.')
    expect(shrink).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it('calls a file the browser cannot draw what it is', async () => {
    shrink.mockRejectedValueOnce(new Error('not an image'))
    render(<PhotoField athleteId="a1" photoUrl={null} />)

    await userEvent.upload(
      screen.getByLabelText('Nahrát fotografii'),
      new File(['x'], 'foto.jpg', { type: 'image/jpeg' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Podporujeme JPG, PNG, WebP a HEIC.')
    expect(upload).not.toHaveBeenCalled()
  })

  it('says so when the upload itself throws', async () => {
    upload.mockRejectedValueOnce(new Error('Body exceeded 1 MB limit'))
    render(<PhotoField athleteId="a1" photoUrl={null} />)

    await userEvent.upload(
      screen.getByLabelText('Nahrát fotografii'),
      new File(['x'], 'foto.jpg', { type: 'image/jpeg' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Fotografii se nepodařilo nahrát. Zkuste to prosím znovu.',
    )
  })
})

/** §G10: the photo row on a child who does not exist yet. */
describe('a photograph for a new child', () => {
  it('keeps the picture for the form instead of uploading it', async () => {
    const onDraft = vi.fn()
    render(<PhotoField onDraft={onDraft} />)

    const picked = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('Nahrát fotografii'), picked)

    await waitFor(() => expect(onDraft).toHaveBeenCalledWith(picked))
    expect(upload).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Změnit fotografii')).toBeInTheDocument()
  })

  it('lets it go again', async () => {
    const onDraft = vi.fn()
    render(<PhotoField onDraft={onDraft} />)

    await userEvent.upload(
      screen.getByLabelText('Nahrát fotografii'),
      new File(['x'], 'foto.jpg', { type: 'image/jpeg' }),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Odebrat fotografii' }))

    expect(onDraft).toHaveBeenLastCalledWith(null)
    expect(screen.getByLabelText('Nahrát fotografii')).toBeInTheDocument()
  })
})
