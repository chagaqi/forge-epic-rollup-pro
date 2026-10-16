import { createRoot } from 'react-dom/client';
import { App } from './App';
import { forgeTransport } from './forgeTransport';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App transport={forgeTransport} />);
