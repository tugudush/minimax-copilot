/**
 * Unit tests for `models/registry.ts` — model metadata and pricing.
 *
 * The registry is deliberately free of `vscode` imports so it can be
 * exercised in plain Node without a module mock.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  MODELS,
  findModel,
  modelName,
  pricingDetail,
} from '../src/models/registry'

/* ---- Tests ---- */

describe('model registry', () => {
  it('registers MiniMax-M3.1-Flash with 1M context and multimodal input', () => {
    const flash = findModel('MiniMax-M3.1-Flash')
    assert.ok(flash, 'M3.1 Flash should be registered')
    assert.strictEqual(flash.contextWindow, 1_048_576)
    assert.strictEqual(flash.multimodal, true)
    assert.strictEqual(flash.thinking, true)
    assert.strictEqual(flash.family, 'm3.1')
  })

  it('marks M3.1 Flash as always-thinking and effort-tunable', () => {
    const flash = findModel('MiniMax-M3.1-Flash')
    assert.ok(flash)
    // The API rejects `thinking: {type:'disabled'}` for this model.
    assert.strictEqual(flash.thinkingAlwaysOn, true)
    assert.strictEqual(flash.effortTunable, true)
  })

  it('does not mark M3 as always-thinking or effort-tunable', () => {
    const m3 = findModel('minimax-m3')
    assert.ok(m3)
    assert.strictEqual(m3.thinkingAlwaysOn, false)
    assert.strictEqual(m3.effortTunable, false)
  })

  it('keeps the M3 family entries intact', () => {
    assert.ok(findModel('minimax-m3'))
    assert.ok(findModel('minimax-m3-priority'))
  })

  it('no longer registers the retired M2.x models', () => {
    assert.strictEqual(findModel('minimax-m2.7'), undefined)
    assert.strictEqual(findModel('minimax-m2.7-highspeed'), undefined)
    assert.strictEqual(findModel('minimax-m2.5'), undefined)
  })

  it('registers exactly three models', () => {
    assert.strictEqual(MODELS.length, 3)
  })

  it('lists M3.1 Flash first in the picker', () => {
    assert.strictEqual(MODELS[0]?.id, 'MiniMax-M3.1-Flash')
  })

  it('returns undefined for an unknown model id', () => {
    assert.strictEqual(findModel('minimax-does-not-exist'), undefined)
  })

  it('gives every model a non-empty display name', () => {
    for (const info of MODELS) {
      assert.ok(modelName(info).length > 0, `${info.id} should have a name`)
    }
  })
})

describe('pricingDetail', () => {
  it('prices M3.1 Flash at $0.15 / $0.60 per M tokens', () => {
    const flash = findModel('MiniMax-M3.1-Flash')
    assert.ok(flash)
    assert.strictEqual(
      pricingDetail(flash),
      '$0.15 / $0.60 per M tokens (PAYG)'
    )
  })

  it('prices M3 standard at $0.30 / $1.20 per M tokens', () => {
    const m3 = findModel('minimax-m3')
    assert.ok(m3)
    // Rates below 1 keep two decimals; rates of 1 or more use one.
    assert.strictEqual(pricingDetail(m3), '$0.30 / $1.2 per M tokens (PAYG)')
  })

  it('applies the 1.5x priority multiplier to M3 Priority', () => {
    const priority = findModel('minimax-m3-priority')
    assert.ok(priority)
    assert.strictEqual(
      pricingDetail(priority),
      '$0.45 / $1.8 per M tokens (PAYG)'
    )
  })

  it('uses the China currency and rate when the China host is active', () => {
    const flash = findModel('MiniMax-M3.1-Flash')
    assert.ok(flash)
    // 0.15 * 7 = 1.05 → "1.1"; 0.60 * 7 = 4.2
    assert.strictEqual(
      pricingDetail(flash, true),
      '¥1.1 / ¥4.2 per M tokens (PAYG)'
    )
  })
})
