import Keycloak from 'keycloak-js';

const keycloak = new Keycloak({
  url: 'http://localhost:8081',
  realm: 'user-key-storage',
  clientId: 'user-key-frontend'
});

export default keycloak;
