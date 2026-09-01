import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return <main><h1>豆泡批量评测</h1><p>PC 端评测控制台正在建设中。</p></main>;
}

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root 容器');
createRoot(root).render(<StrictMode><App /></StrictMode>);
