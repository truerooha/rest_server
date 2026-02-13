import { config } from './config'

export const ORDER_CONFIG = {
  orderLeadMinutes: 150,
  minLobbyParticipants: config.minLobbyParticipants,
  lobbyLeadMinutes: 150,
  deliveryPriceCentsWhenNotFull: 8300,
  deliverySlots: [
    { id: '13:00', time: '13:00' },
    { id: '17:43', time: '17:43' },
    { id: '23:00', time: '23:00' },
  ],
}
