import Sidebar from './Sidebar'

export default function Layout({ children }) {
  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>
      <Sidebar />
      <main style={{ flex:1, overflow:'auto', background:'#f7f8fa' }}>
        {children}
      </main>
    </div>
  )
}
