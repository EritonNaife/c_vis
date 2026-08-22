import './app.css';
import './state-feedback.css';
import './v0.4.css';
import './runtime-visualization.css';
import App from './App.svelte';
import { mount } from 'svelte';

mount(App, { target: document.getElementById('app') });
