# Маршруты и адреса

- Для перехода между VLAN найдите границу коммутации и устройство, которое
  маршрутизирует трафик дальше. Сверьте точку фильтрации с маршрутом.
  [Документация ядра Linux, Ethernet Bridging, раздел VLAN](https://www.kernel.org/doc/html/latest/networking/bridge.html#vlan),
  [NIST SP 800-41 Rev. 1, § 3.1](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-41r1.pdf#page=23)
- Для фильтрации по IP сверяйте длину CIDR-префикса. Она определяет, какая часть
  адреса относится к сети. [RFC 4632, § 3.1](https://www.rfc-editor.org/rfc/rfc4632.html#section-3.1)
- В DNS-имени родительский домен определяется по целым меткам. Для правила
  по имени уточните, какое DNS-имя разрешается и охватывает ли правило поддомены.
  [RFC 1034, § 3.1 и 5.1](https://www.rfc-editor.org/rfc/rfc1034.html#section-3.1)
