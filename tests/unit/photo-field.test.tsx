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
  jpegName: (name: string) => name,
}))

function heic(bytes = 1024): File {
  return new File([new Uint8Array(bytes)], 'IMG_0421.HEIC', { type: '' })
}

beforeEach(() => {
  uploaded.length = 0
  upload.mockClear()
  convert.mockClear()
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
