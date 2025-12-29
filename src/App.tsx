import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { getSupabaseClient } from './lib/supabase'
import LoginPage from './pages/LoginPage'
import TripsPage from './pages/TripsPage'
import TripDetailPage from './pages/TripDetailPage'
import AdminTripPage from './pages/AdminTripPage'
import AdminNewTripPage from './pages/AdminNewTripPage'
import './App.css'

const supabase = getSupabaseClient()

function AppRoutes() {
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={!session ? <LoginPage /> : <Navigate to="/trips" />} />
      <Route path="/trips" element={session ? <TripsPage /> : <Navigate to="/login" />} />
      <Route path="/trips/:slug" element={session ? <TripDetailPage /> : <Navigate to="/login" />} />
      <Route path="/admin/trips/new" element={session ? <AdminNewTripPage /> : <Navigate to="/login" />} />
      <Route path="/admin/trips/:id" element={session ? <AdminTripPage /> : <Navigate to="/login" />} />
      <Route path="/" element={<Navigate to={session ? "/trips" : "/login"} />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <AppRoutes />
    </BrowserRouter>
  )
}
