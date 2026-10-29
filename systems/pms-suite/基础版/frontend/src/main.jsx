import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import ArchiveNotice from './components/archive/ArchiveNotice.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ArchiveNotice />
    <App />
  </StrictMode>,
)
