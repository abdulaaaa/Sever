import '../../assets/styles/theme.css';
import Analytics from './Analytics.svelte';
import { mount } from 'svelte';

const app = mount(Analytics, {
  target: document.getElementById('app')!
});

export default app;
