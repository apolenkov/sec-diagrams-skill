# Схема и правила

- [ ] Сверьте поток от исходного узла до сервиса через каждую границу сети.
  Проверьте, что правила на этих границах охватывают указанные адреса и трафик.
  [NIST SP 800-41 Rev. 1, § 3.1](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-41r1.pdf#page=23), [NIST SP 800-41 Rev. 1, § 5.2.2](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-41r1.pdf#page=38)
- [ ] Для TCP и UDP сверьте службу, транспорт и порт по конфигурации. При фильтрации ICMP проверьте
  допустимые типы сообщений и условия их прохождения. [NIST SP 800-41 Rev. 1, § 4.1.3-4.1.4](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-41r1.pdf#page=31),
  [NIST SP 800-41 Rev. 1, § 5.3](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-41r1.pdf#page=40)
- [ ] Проверьте служебный трафик, необходимый самому МЭ, включая разрешение имен,
  синхронизацию времени и отправку журналов, если они используются. [NIST SP 800-41 Rev. 1, § 5.2.2](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-41r1.pdf#page=38)
