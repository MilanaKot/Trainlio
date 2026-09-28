import { describe, expect, it } from 'vitest'
import { clampOffset, clampZoom, coverScale, sourceRect } from '@/lib/domain/crop'

const WINDOW = 200

describe('filling the crop window (admin/SPEC.md §A5)', () => {
  it('scales by the shorter side, so no corner is empty', () => {
    expect(coverScale({ width: 1000, height: 500 }, WINDOW)).toBe(0.4)
    expect(coverScale({ width: 500, height: 1000 }, WINDOW)).toBe(0.4)
  })

  it('enlarges an image smaller than the window', () => {
    expect(coverScale({ width: 100, height: 100 }, WINDOW)).toBe(2)
  })

  it('does not divide by a zero an SVG can report', () => {
    expect(coverScale({ width: 0, height: 0 }, WINDOW)).toBe(1)
  })
})

describe('dragging', () => {
  const rendered = { width: 400, height: 200 }

  it('leaves an offset inside the edges alone', () => {
    expect(clampOffset({ x: -50, y: 0 }, rendered, WINDOW)).toEqual({ x: -50, y: 0 })
  })

  // A finger that has gone too far stops at the edge rather than snapping back.
  it('stops at the edge instead of refusing the drag', () => {
    expect(clampOffset({ x: 40, y: 0 }, rendered, WINDOW)).toEqual({ x: 0, y: 0 })
    expect(clampOffset({ x: -1000, y: 0 }, rendered, WINDOW)).toEqual({ x: -200, y: 0 })
  })

  it('centres an image the slider has shrunk below the window', () => {
    expect(clampOffset({ x: -30, y: -30 }, { width: 100, height: 100 }, WINDOW)).toEqual({
      x: 50,
      y: 50,
    })
  })
})

describe('the square that is copied out', () => {
  const natural = { width: 1000, height: 500 }

  it('is the whole shorter side when nothing has been moved', () => {
    const scale = coverScale(natural, WINDOW)
    const offset = clampOffset({ x: -100, y: 0 }, { width: 400, height: 200 }, WINDOW)
    expect(sourceRect(offset, natural, scale, WINDOW)).toEqual({ x: 250, y: 0, size: 500 })
  })

  it('shrinks as the image is enlarged', () => {
    const scale = coverScale(natural, WINDOW) * 2
    expect(sourceRect({ x: 0, y: 0 }, natural, scale, WINDOW).size).toBe(250)
  })

  it('never reads from beyond the bitmap', () => {
    const scale = coverScale(natural, WINDOW)
    expect(sourceRect({ x: -10000, y: -10000 }, natural, scale, WINDOW)).toEqual({
      x: 500,
      y: 0,
      size: 500,
    })
  })
})

describe('the zoom slider', () => {
  it('runs from half to one and a half', () => {
    expect(clampZoom(0.2)).toBe(0.5)
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(9)).toBe(1.5)
  })
})
