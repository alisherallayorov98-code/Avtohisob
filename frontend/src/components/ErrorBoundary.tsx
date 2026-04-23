import { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  reset = () => {
    // Chunk loading errors can't be fixed by React state reset alone —
    // the missing JS chunk stays missing until a full page reload.
    const isChunkError = this.state.error?.message?.includes('Failed to fetch dynamically imported module')
      || this.state.error?.message?.includes('Importing a module script failed')
      || this.state.error?.message?.includes('Loading chunk')
    if (isChunkError) {
      window.location.reload()
    } else {
      this.setState({ hasError: false, error: null })
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="min-h-[60vh] flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              Sahifada xatolik yuz berdi
            </h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
              Kutilmagan xatolik yuz berdi. Sahifani yangilang yoki qaytadan urinib ko'ring.
            </p>
            {this.state.error && (
              <details className="text-left mb-4 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-xs text-gray-500 dark:text-gray-400">
                <summary className="cursor-pointer font-medium mb-1">Xatolik tafsiloti</summary>
                <pre className="overflow-auto whitespace-pre-wrap">{this.state.error.message}</pre>
              </details>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.reset}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Qaytadan urinish
              </button>
              <button
                onClick={() => window.location.href = '/'}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors"
              >
                Bosh sahifaga
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
