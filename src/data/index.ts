import roles from './roles.json';
import vehicles from './vehicles.json';
import incidents from './incidents.json';
import mapDefault from './map_default.json';
import missions from './missions.json';
import { emptyContent, mergeContent } from '../sim/content';
import type { Content } from '../sim/types';

/** Built-in content. Validation runs at load time so broken data fails loudly in dev and in tests. */
export function loadBuiltinContent(): Content {
  const { content, errors } = mergeContent(emptyContent(), { roles, vehicles, incidents, maps: [mapDefault], missions }, 'builtin');
  if (errors.length) throw new Error('Ongeldige ingebouwde content:\n' + errors.join('\n'));
  return content;
}
