import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ButtonShapeProvider, ToastProvider, UiLabelsProvider } from '@/ui'
import { ThemeProvider } from '@/theme/theme-provider'
import AuthCallback from '@/auth/AuthCallback'
import { AuthGuard } from '@/auth/AuthGuard'
import { isAuthEnabled, SessionProvider } from '@/auth/provider'
import { Workspace } from '@/app/Workspace'
import { LoginPage } from '@/pages/Login'
import { copy } from '@/i18n'

const UI_LABELS = { close: 'Cerrar', moreInfo: 'Más información', why: '¿Por qué?', grid: copy.grid }

export default function App() {
  return (
    <ThemeProvider>
      <UiLabelsProvider labels={UI_LABELS}>
        <ToastProvider
          labels={{
            dismiss: 'Cerrar aviso',
            region: 'Avisos',
            open: 'Abrir',
            kind: {
              default: 'Aviso',
              success: 'Hecho',
              error: 'Error',
              warning: 'Aviso',
              info: 'Información',
              loading: 'Cargando',
            },
          }}
        >
          <ButtonShapeProvider value="square">
            <SessionProvider>
              <BrowserRouter>
                <Routes>
                  <Route path="/login" element={isAuthEnabled ? <LoginPage /> : <Navigate to="/" replace />} />
                  <Route path="/login/callback" element={<AuthCallback />} />
                  <Route path="/auth/callback" element={<AuthCallback />} />
                  <Route path="/auth/*" element={<Navigate to={isAuthEnabled ? '/login' : '/'} replace />} />
                  <Route
                    path="/*"
                    element={
                      <AuthGuard requireAuth>
                        <Workspace />
                      </AuthGuard>
                    }
                  />
                </Routes>
              </BrowserRouter>
            </SessionProvider>
          </ButtonShapeProvider>
        </ToastProvider>
      </UiLabelsProvider>
    </ThemeProvider>
  )
}
