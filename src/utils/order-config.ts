import { config } from './config'

export const ORDER_CONFIG = {
  orderLeadMinutes: 90,
  minLobbyParticipants: config.minLobbyParticipants,
  lobbyLeadMinutes: 90,
  deliveryPriceCentsWhenNotFull: 8300,
  deliverySlots: [
    { id: '13:00', time: '13:00' },
    { id: '14:20', time: '14:20' },
    { id: '17:00', time: '17:00' },

  ],
}
