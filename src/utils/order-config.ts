import { config } from './config'

export const ORDER_CONFIG = {
  orderLeadMinutes: 150,
  minLobbyParticipants: config.minLobbyParticipants,
  lobbyLeadMinutes: 150,
  deliveryPriceCentsWhenNotFull: 8300,
  deliverySlots: [
    { id: '13:00', time: '13:00' },
    { id: '15:00', time: '15:00' },
    { id: '17:00', time: '17:00' },
    { id: '19:00', time: '19:00' },
    { id: '21:00', time: '21:00' },
    { id: '23:00', time: '23:00' },
  ],
}
