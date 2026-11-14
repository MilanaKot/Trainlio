import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ redirect: () => undefined }))

import { PAGE_ROWS, allRows } from '@/server/query-result'

/** A table of `total` rows behind PostgREST's cap, read with `.range`. */
function table(total: number) {
  const ranges: [number, number][] = []
  const page = async (from: number, to: number) => {
    ranges.push([from, to])
    const end = Math.min(to + 1, total)
    return {
      data: Array.from({ length: Math.max(end - from, 0) }, (_, i) => from + i),
      error: null,
    }
  }
  return { page, ranges }
}

describe('reading past the thousand-row cap', () => {
  it('fetches every row, a page at a time', async () => {
    const { page, ranges } = table(2500)
    const rows = await allRows('test', page)
    expect(rows).toHaveLength(2500)
    expect(rows[2499]).toBe(2499)
    expect(ranges).toEqual([
      [0, PAGE_ROWS - 1],
      [PAGE_ROWS, 2 * PAGE_ROWS - 1],
      [2 * PAGE_ROWS, 3 * PAGE_ROWS - 1],
    ])
  })

  it('asks once more when the last page is exactly full', async () => {
    const { page, ranges } = table(PAGE_ROWS)
    expect(await allRows('test', page)).toHaveLength(PAGE_ROWS)
    expect(ranges).toHaveLength(2)
  })

  it('asks once for a short list', async () => {
    const { page, ranges } = table(12)
    expect(await allRows('test', page)).toHaveLength(12)
    expect(ranges).toHaveLength(1)
  })
})
