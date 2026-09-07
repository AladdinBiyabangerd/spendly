import { useMemo, useState } from 'react'
import {
  hasCredentialErrors,
  validateCredentials,
  MIN_PASSWORD_LENGTH,
} from '../lib/credentials'
import type { CredentialErrors } from '../lib/credentials'
import { useAuth } from '../store/AuthProvider'

type Mode = 'sign-in' | 'sign-up'

/**
 * Sign in, or create an account.
 *
 * One form with two modes rather than two screens: the fields are identical
 * and someone who mistook one for the other should not have to navigate to
 * fix it.
 */
export function AuthScreen() {
  const { signIn, signUp, sendPasswordReset, notice } = useAuth()
  const [resetting, setResetting] = useState(false)
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const errors: CredentialErrors = useMemo(
    () => validateCredentials({ email, password }, mode),
    [email, password, mode],
  )
  const visible = showErrors ? errors : {}

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setFailure(null)
    if (hasCredentialErrors(errors)) {
      setShowErrors(true)
      return
    }

    setBusy(true)
    try {
      if (mode === 'sign-up') {
        await signUp(email, password)
      } else {
        await signIn(email, password)
      }
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Alınmadı')
    } finally {
      setBusy(false)
    }
  }

  const switchTo = (next: Mode) => {
    setMode(next)
    setShowErrors(false)
    setFailure(null)
  }

  if (resetting) {
    return <ResetRequest onBack={() => setResetting(false)} onSend={sendPasswordReset} />
  }

  return (
    <div className="auth">
      <form className="auth-card card" onSubmit={submit} noValidate>
        <div className="auth-head">
          <span className="brand">
            <span className="brand-mark" aria-hidden="true">S</span>
            <span className="wordmark">Spendly</span>
          </span>
          <p className="auth-lead">
            {mode === 'sign-in'
              ? 'Məlumatlarınıza çıxış üçün hesabınıza daxil olun.'
              : 'Məlumatlarınız hesabınıza bağlanır — istənilən brauzerdən açıla bilər.'}
          </p>
        </div>

        <div className="segmented auth-modes">
          <button
            type="button"
            className="segment"
            aria-pressed={mode === 'sign-in'}
            onClick={() => switchTo('sign-in')}
          >
            Daxil ol
          </button>
          <button
            type="button"
            className="segment"
            aria-pressed={mode === 'sign-up'}
            onClick={() => switchTo('sign-up')}
          >
            Qeydiyyat
          </button>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="auth-email">
            E-poçt
          </label>
          <input
            id="auth-email"
            className="input"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            aria-invalid={Boolean(visible.email)}
            onChange={(event) => setEmail(event.target.value)}
          />
          {visible.email && <p className="field-error">{visible.email}</p>}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="auth-password">
            Şifrə
          </label>
          <input
            id="auth-password"
            className="input"
            type="password"
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            value={password}
            aria-invalid={Boolean(visible.password)}
            onChange={(event) => setPassword(event.target.value)}
          />
          {visible.password ? (
            <p className="field-error">{visible.password}</p>
          ) : (
            mode === 'sign-up' && (
              <p className="field-hint">Ən azı {MIN_PASSWORD_LENGTH} simvol.</p>
            )
          )}
        </div>

        {failure && <p className="auth-failure">{failure}</p>}
        {notice && <p className="auth-notice">{notice}</p>}

        <button type="submit" className="button button-primary auth-submit" disabled={busy}>
          {busy ? 'Gözləyin…' : mode === 'sign-in' ? 'Daxil ol' : 'Hesab yarat'}
        </button>

        {mode === 'sign-in' && (
          <p className="auth-forgot">
            <button type="button" onClick={() => setResetting(true)}>
              Şifrənizi unutmusunuz?
            </button>
          </p>
        )}

        <p className="auth-switch">
          {mode === 'sign-in' ? (
            <>
              Hesabınız yoxdur?{' '}
              <button type="button" onClick={() => switchTo('sign-up')}>
                Qeydiyyatdan keçin
              </button>
            </>
          ) : (
            <>
              Hesabınız var?{' '}
              <button type="button" onClick={() => switchTo('sign-in')}>
                Daxil olun
              </button>
            </>
          )}
        </p>
      </form>
      <p className="auth-builder">
        Dizayn edib hazırlayan{' '}
        <a
          href="https://aladdinbiyabangerd.site/az?utm_source=spendly&utm_medium=organic_social&utm_campaign=portfolio&utm_content=auth_credit"
          target="_blank"
          rel="noopener noreferrer"
        >
          Aladdin Biyabangerd
          <span aria-hidden> ↗</span>
        </a>
      </p>
    </div>
  )
}

/**
 * Ask for the reset link.
 *
 * The confirmation is the same whether or not the address has an account. An
 * app that says "no such user" is an app that will tell anyone which addresses
 * are registered, and the person who genuinely mistyped their own address is
 * helped just as well by being told to check the mailbox.
 */
function ResetRequest({
  onBack,
  onSend,
}: {
  onBack: () => void
  onSend(email: string): Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setFailure(null)
    setBusy(true)
    try {
      await onSend(email)
      setSent(true)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Alınmadı')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <form className="auth-card card" onSubmit={submit} noValidate>
        <div className="auth-head">
          <span className="brand">
            <span className="brand-mark" aria-hidden="true">S</span>
            <span className="wordmark">Spendly</span>
          </span>
          <p className="auth-lead">
            E-poçt ünvanınızı yazın — şifrəni yeniləmək üçün link göndərəcəyik.
          </p>
        </div>

        {sent ? (
          <>
            <p className="auth-notice">
              Əgər bu ünvanla hesab varsa, link göndərildi. Poçtunuzu yoxlayın —
              spam qovluğuna da baxın.
            </p>
            <button type="button" className="button" onClick={onBack}>
              Girişə qayıt
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <label className="field-label" htmlFor="reset-email">
                E-poçt
              </label>
              <input
                id="reset-email"
                className="input"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            {failure && <p className="auth-failure">{failure}</p>}

            <button
              type="submit"
              className="button button-primary auth-submit"
              disabled={busy}
            >
              {busy ? 'Gözləyin…' : 'Link göndər'}
            </button>

            <p className="auth-switch">
              <button type="button" onClick={onBack}>
                Girişə qayıt
              </button>
            </p>
          </>
        )}
      </form>
    </div>
  )
}
