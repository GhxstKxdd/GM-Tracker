import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AuthPage } from './AuthPage'

describe('AuthPage first-time setup', () => {
  it('asks for a valid GM username separately from the display name', () => {
    const markup = renderToStaticMarkup(createElement(AuthPage, {
      initialized: false,
      onLogin: async () => {},
      onSetup: async () => {},
      onRecover: async () => {}
    }))

    expect(markup).toContain('<label>GM display name')
    expect(markup).toContain('<label>GM username')
    expect(markup).toContain('autoComplete="username"')
    expect(markup).toContain('pattern="[A-Za-z0-9._-]+"')
    expect(markup).toContain('minLength="3"')
    expect(markup).toContain('maxLength="32"')
  })
})
